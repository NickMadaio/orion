"""Explicit P-256/SHA-256 verification for Apple's device-key signatures.

Wire key: canonical padded base64 of the 65-byte uncompressed X9.63 point.
Signature: ASN.1 DER, as returned by ecdsaSignatureMessageX962SHA256.
This is not JOSE ES256's raw r||s encoding. No PEM, alternate curves or key
aliases are accepted: the registry uses the wire string as key identity.
"""
import base64
import binascii

from backend.devices.proofs import VerifierUnavailable


class P256Verifier:
    algorithm = "p256-sha256-der-v1"

    def __init__(self):
        try:
            from cryptography.exceptions import InvalidSignature, UnsupportedAlgorithm
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import ec
        except ImportError as error:
            raise VerifierUnavailable("P-256 verification requires the device-crypto optional dependency") from error
        self._ec = ec
        self._hashes = hashes
        self._invalid = InvalidSignature
        self._unsupported = UnsupportedAlgorithm

    def verify(self, public_key: str, message: bytes, signature: bytes) -> bool:
        if (not isinstance(public_key, str) or len(public_key) != 88
                or not isinstance(message, bytes) or len(message) > 16384
                or not isinstance(signature, bytes) or not 8 <= len(signature) <= 72):
            return False
        try:
            point = base64.b64decode(public_key, validate=True)
            if len(point) != 65 or point[0] != 4 or base64.b64encode(point).decode("ascii") != public_key:
                return False
            key = self._ec.EllipticCurvePublicKey.from_encoded_point(self._ec.SECP256R1(), point)
            key.verify(signature, message, self._ec.ECDSA(self._hashes.SHA256()))
            return True
        except (ValueError, binascii.Error, self._invalid):
            return False
        except self._unsupported as error:
            raise VerifierUnavailable("P-256 verification unavailable in this crypto runtime") from error
