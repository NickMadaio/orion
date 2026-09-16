import base64
from contextlib import closing
import http.client
import json
from pathlib import Path
import sqlite3
import socket
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.adapters.local_today import local_server
from backend.local_today.device_sessions import DeviceReadSessions
from backend.local_today.session_exchange import LocalSessionExchange, ExchangeRejected
from backend.local_today.repository import TodaySnapshotRepository
from backend.devices.durable import DurableDeviceRegistry
from backend.devices.proofs import HmacVerifier
from tests.test_v2_device_identity import NOW, owner, register, MAC_KEY, sign, SECRETS

class LocalSessionExchangeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.registry=DurableDeviceRegistry(self.root/'devices', verifier=HmacVerifier(SECRETS), create=True)
        self.owner=owner()
        register(self.registry,self.owner)
        self.clock=100.0
        self.sessions=DeviceReadSessions(self.registry,clock=lambda:self.clock)
        self.exchange=LocalSessionExchange(self.sessions,clock=lambda:self.clock,now=lambda:NOW)
        self.grant=self.exchange.authorize(self.owner,'device-mac-0001')
        self.repo=TodaySnapshotRepository(self.root/'today')
        self.repo.put(self.owner,'today-plan',{'revision':1,'capturedAt':0,'plan':None})
        self.server=local_server(self.repo,self.sessions,exchange=self.exchange)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(3)

    def request(self,path,body=None,token=None,method='POST'):
        data=None if body is None else json.dumps(body).encode()
        headers={'Content-Type':'application/json','Authorization':'Bearer '+(self.grant if token is None else token)}
        request=Request(f'http://127.0.0.1:{self.server.server_port}'+path,data=data,headers=headers,method=method)
        try: response=urlopen(request,timeout=3)
        except HTTPError as error: response=error
        with response: return response.status,json.load(response)

    def proof(self,challenge):
        message=self.sessions.message(self.owner,'device-mac-0001',MAC_KEY,challenge)
        return {'challenge':challenge,'signature':base64.b64encode(sign(MAC_KEY,message)).decode()}

    def test_actual_exchange_read_and_durable_revocation(self):
        self.assertEqual(self.request('/plan',token=self.grant,method='GET')[0],401)
        status,value=self.request('/session/challenge',{})
        self.assertEqual(status,200)
        self.assertEqual(value['ownerID'],str(self.owner.user_id))
        status,result=self.request('/session/exchange',self.proof(value['challenge']))
        self.assertEqual(status,200)
        self.assertEqual(self.request('/plan',token=result['token'],method='GET')[0],200)
        self.assertEqual(self.request('/session/exchange',self.proof(value['challenge']))[0],401)
        self.registry.revoke(self.owner,'device-mac-0001',now=NOW)
        self.assertEqual(self.request('/plan',token=result['token'],method='GET')[0],401)

    def test_unknown_expired_and_restarted_grants_refused(self):
        self.assertEqual(self.request('/session/challenge',{},token='invalid')[0],401)
        self.clock+=120
        self.assertEqual(self.request('/session/challenge',{})[0],401)
        fresh=LocalSessionExchange(self.sessions)
        with self.assertRaises(ExchangeRejected):fresh.handle('/session/challenge','Bearer '+self.grant,{})

    def test_failed_signature_consumes_grant(self):
        _,value=self.request('/session/challenge',{})
        body=self.proof(value['challenge'])
        self.assertEqual(self.request('/session/exchange',{**body,'signature':base64.b64encode(b'wrong').decode()})[0],401)
        self.assertEqual(self.request('/session/exchange',body)[0],401)

    def test_client_cannot_select_account_or_device(self):
        self.assertEqual(self.request('/session/challenge',{'ownerID':'other-owner'})[0],401)
        _,value=self.request('/session/challenge',{})
        self.assertEqual(self.request('/session/exchange',{**self.proof(value['challenge']),'deviceID':'other-device'})[0],401)

    def test_revocation_before_exchange_refuses(self):
        _,value=self.request('/session/challenge',{})
        self.registry.revoke(self.owner,'device-mac-0001',now=NOW)
        self.assertEqual(self.request('/session/exchange',self.proof(value['challenge']))[0],401)

    def test_storage_failure_refuses_without_reusable_bootstrap(self):
        _,value=self.request('/session/challenge',{})
        with closing(sqlite3.connect(self.root/'devices/devices.sqlite3')) as db,db:db.execute('PRAGMA user_version=99')
        self.assertEqual(self.request('/session/exchange',self.proof(value['challenge']))[0],503)
        with closing(sqlite3.connect(self.root/'devices/devices.sqlite3')) as db,db:db.execute('PRAGMA user_version=1')
        self.assertEqual(self.request('/session/exchange',self.proof(value['challenge']))[0],401)

    def test_route_and_method_scope(self):
        for method in ('PUT','PATCH','DELETE'):
            self.assertEqual(self.request('/session/challenge',{},method=method)[0],405)
        self.assertEqual(self.request('/plan',{})[0],405)
        self.assertEqual(self.request('/session/challenge?owner=other',{})[0],405)
        self.assertEqual(self.request('/session/challenge',method='GET')[0],404)

    def test_short_body_at_eof_is_refused_without_issuing_challenge(self):
        with socket.create_connection(('127.0.0.1',self.server.server_port),timeout=3) as connection:
            request=(f'POST /session/challenge HTTP/1.0\r\nHost: localhost\r\nAuthorization: Bearer {self.grant}\r\n'
                     'Content-Type: application/json\r\nContent-Length: 10\r\n\r\n{}').encode()
            connection.sendall(request)
            connection.shutdown(socket.SHUT_WR)
            response=connection.makefile('rb')
            with response:
                self.assertIn(b' 400 ',response.readline())
                response.read()
        self.assertEqual(self.request('/session/challenge',{})[0],200)

    def test_framing_duplicates_and_oversized_bodies_refused(self):
        cases=[([('Content-Length','2'),('Content-Length','2')],b'{}'),
               ([('Content-Length','2'),('Transfer-Encoding','chunked')],b'{}'),
               ([('Content-Length','99999999999999999')],b'{}'),
               ([('Content-Length','13')],b'{"x":1,"x":2}'),
               ([('Content-Length','2')],b'[]')]
        for extra,body in cases:
            connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
            try:
                connection.putrequest('POST','/session/challenge')
                connection.putheader('Authorization','Bearer '+self.grant)
                connection.putheader('Content-Type','application/json')
                for name,value in extra:connection.putheader(name,value)
                connection.endheaders(body)
                response=connection.getresponse(); response.read()
                self.assertEqual(response.status,400)
            finally:connection.close()

if __name__ == '__main__':unittest.main()
