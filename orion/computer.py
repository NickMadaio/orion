from __future__ import annotations

import json
import shutil
import subprocess
import uuid
from pathlib import Path


class ComputerTools:
    """Phase Four computer tools confined to Orion's dedicated sandbox folder."""

    def __init__(self, sandbox: Path, control_dir: Path | None = None) -> None:
        self.sandbox = sandbox.resolve()
        self.sandbox.mkdir(parents=True, exist_ok=True)
        self.control = (control_dir or self.sandbox / ".orion").resolve()
        self.control.mkdir(parents=True, exist_ok=True)

    def _path(self, relative: str) -> Path:
        candidate = (self.sandbox / relative).resolve()
        if candidate != self.sandbox and self.sandbox not in candidate.parents:
            raise ValueError("That path is outside Orion's permitted sandbox.")
        if self.control == self.sandbox / ".orion" and (candidate == self.control or self.control in candidate.parents):
            raise ValueError("Orion's internal safety records are not available to tools.")
        return candidate

    def list_files(self, relative: str = ".") -> list[str]:
        folder = self._path(relative)
        if not folder.is_dir():
            raise ValueError("That is not a folder.")
        return sorted(str(item.relative_to(self.sandbox)) for item in folder.iterdir() if item.name != ".orion")

    def read_file(self, relative: str) -> str:
        return self._path(relative).read_text()

    def propose(self, summary: str, actions: list[dict], metadata: dict | None = None) -> dict:
        if not actions:
            raise ValueError("A proposal needs at least one action.")
        for action in actions:
            kind = action.get("kind")
            if kind not in {"create", "write", "edit", "move", "mkdir", "delete"}:
                raise ValueError(f"Unsupported sandbox action: {kind}")
            self._path(str(action.get("path") or action.get("source") or ""))
            if kind == "move":
                self._path(str(action.get("destination") or ""))
        proposal_id = uuid.uuid4().hex
        proposal = {
            "id": proposal_id,
            "summary": summary,
            "actions": actions,
            "preview": self._preview(actions),
            "status": "pending",
            "metadata": metadata or {},
        }
        (self.control / f"{proposal_id}.json").write_text(json.dumps(proposal, indent=2))
        return proposal

    def get_proposal(self, proposal_id: str) -> dict:
        return json.loads((self.control / f"{proposal_id}.json").read_text())

    def _preview(self, actions: list[dict]) -> list[str]:
        preview: list[str] = []
        for action in actions:
            kind = action["kind"]
            if kind in {"create", "write", "edit"}:
                path = self._path(action["path"])
                old = path.read_text() if path.exists() else ""
                preview.append(f"{kind} {action['path']}: {old!r} → {action.get('content', '')!r}")
            elif kind == "move":
                preview.append(f"move {action['source']} → {action['destination']}")
            elif kind == "delete":
                path = self._path(action["path"])
                preview.append(f"delete {action['path']}: {path.read_text()!r}" if path.exists() and path.is_file() else f"delete {action['path']}")
            else:
                preview.append(f"create folder {action['path']}")
        return preview

    def execute(self, proposal_id: str) -> dict:
        proposal_file = self.control / f"{proposal_id}.json"
        proposal = json.loads(proposal_file.read_text())
        if proposal["status"] != "pending":
            raise ValueError("That proposal is no longer awaiting approval.")
        rollback = []
        for action in proposal["actions"]:
            kind = action["kind"]
            if kind == "mkdir":
                self._path(action["path"]).mkdir(parents=True, exist_ok=True)
                rollback.append({"kind": "rmdir", "path": action["path"]})
            elif kind in {"create", "write", "edit"}:
                path = self._path(action["path"])
                backup = path.read_text() if path.exists() else None
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(action.get("content", ""))
                rollback.append({"kind": "write", "path": action["path"], "content": backup})
            elif kind == "delete":
                path = self._path(action["path"])
                if not path.exists():
                    raise ValueError("That path no longer exists.")
                if path.is_dir():
                    raise ValueError("Folder deletion is not available yet; Orion will ask for a narrower action.")
                backup = path.read_text()
                path.unlink()
                rollback.append({"kind": "write", "path": action["path"], "content": backup})
            else:
                source, destination = self._path(action["source"]), self._path(action["destination"])
                destination.parent.mkdir(parents=True, exist_ok=True)
                source.rename(destination)
                rollback.append({"kind": "move", "source": action["destination"], "destination": action["source"]})
        proposal.update({"status": "executed", "rollback": rollback})
        proposal_file.write_text(json.dumps(proposal, indent=2))
        return proposal

    def propose_organization(self, moves: list[dict]) -> dict:
        actions = [{"kind": "move", "source": item["source"], "destination": item["destination"]} for item in moves]
        return self.propose("Organize sandbox folder", actions)

    def rollback(self, proposal_id: str) -> None:
        proposal_file = self.control / f"{proposal_id}.json"
        proposal = json.loads(proposal_file.read_text())
        if proposal["status"] != "executed":
            raise ValueError("Only an executed proposal can be rolled back.")
        for action in reversed(proposal["rollback"]):
            if action["kind"] == "move":
                self._path(action["source"]).rename(self._path(action["destination"]))
            elif action["kind"] == "write":
                path = self._path(action["path"])
                if action["content"] is None:
                    path.unlink(missing_ok=True)
                else:
                    path.write_text(action["content"])
            elif action["kind"] == "rmdir":
                self._path(action["path"]).rmdir()
        proposal["status"] = "rolled_back"
        proposal_file.write_text(json.dumps(proposal, indent=2))

    def run_readonly(self, command: list[str]) -> str:
        if not command or command[0] not in {"pwd", "ls", "find", "cat"}:
            raise ValueError("Only read-only pwd, ls, find, and cat commands are permitted.")
        completed = subprocess.run(command, cwd=self.sandbox, text=True, capture_output=True, timeout=10, check=False)
        return (completed.stdout + completed.stderr)[:12000]

    def propose_terminal_change(self, command: list[str]) -> dict:
        """Translate a small, safe state-changing command set into a normal approval proposal."""
        if not command:
            raise ValueError("A terminal command is required.")
        program, *arguments = command
        if program == "mkdir" and len(arguments) == 1:
            return self.propose(f"Create folder {arguments[0]}", [{"kind": "mkdir", "path": arguments[0]}])
        if program == "touch" and len(arguments) == 1:
            return self.propose(f"Create file {arguments[0]}", [{"kind": "create", "path": arguments[0], "content": ""}])
        if program == "mv" and len(arguments) == 2:
            return self.propose(f"Move {arguments[0]} to {arguments[1]}", [{"kind": "move", "source": arguments[0], "destination": arguments[1]}])
        raise ValueError("Only sandboxed mkdir, touch, and mv are currently available as approval-gated terminal actions.")
