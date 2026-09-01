"""The dependency graph, and the two things it must never allow.

A cycle means nothing in it can ever start, and the failure is silent: the
planner simply never schedules those tasks and nobody is told why. So a cycle is
refused at the moment the edge is added, when there is still a caller to tell.

Blocking is derived here rather than stored on the task, for the reason
`Status` gives: a stored BLOCKED is a cached answer to a question that changes
when some other row changes.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from backend.tasks.attributes import Status
from backend.tasks.task import Task, TaskRefused


class DependencyRefused(TaskRefused):
    """The edge was refused, and the reason names the cycle or the missing task."""


def _graph(tasks: Iterable[Task]) -> dict[str, Task]:
    by_id: dict[str, Task] = {}
    for task in tasks:
        if task.id in by_id:
            raise DependencyRefused(f"task {task.id} appears twice")
        by_id[task.id] = task
    return by_id


def check(tasks: Iterable[Task]) -> Mapping[str, Task]:
    """Validate the whole graph: every dependency exists, and there is no cycle.

    Returns the tasks by id so a caller that has already paid for the walk does
    not walk them again.
    """

    by_id = _graph(tasks)
    for task in by_id.values():
        for dependency in task.dependencies:
            if dependency not in by_id:
                raise DependencyRefused(
                    f"{task.id} depends on {dependency}, which is not in this set"
                )
            if by_id[dependency].user_id != task.user_id:
                # Phase 11's ownership rule, at the one place a graph could
                # cross it: an edge to another person's task would make their
                # progress visible through whether yours is blocked.
                raise DependencyRefused(
                    f"{task.id} depends on a task owned by somebody else"
                )
    cycle = find_cycle(by_id)
    if cycle is not None:
        raise DependencyRefused("dependency cycle: " + " -> ".join(cycle))
    return by_id


def find_cycle(by_id: Mapping[str, Task]) -> tuple[str, ...] | None:
    """The first cycle found, as the path that closes it, or None.

    Iterative rather than recursive: a long chain of tasks is a plausible thing
    for a person to build, and blowing the Python stack on it would turn a
    supported shape into a crash.
    """

    UNVISITED, ACTIVE, DONE = 0, 1, 2
    state = {task_id: UNVISITED for task_id in by_id}

    for root in by_id:
        if state[root] != UNVISITED:
            continue
        stack: list[tuple[str, list[str]]] = [(root, list(by_id[root].dependencies))]
        path = [root]
        state[root] = ACTIVE
        while stack:
            node, pending = stack[-1]
            if not pending:
                state[node] = DONE
                stack.pop()
                path.pop()
                continue
            nxt = pending.pop()
            if nxt not in state:
                continue
            if state[nxt] == ACTIVE:
                closing = path[path.index(nxt):] + [nxt]
                return tuple(closing)
            if state[nxt] == DONE:
                continue
            state[nxt] = ACTIVE
            path.append(nxt)
            stack.append((nxt, list(by_id[nxt].dependencies)))
    return None


def would_cycle(by_id: Mapping[str, Task], task_id: str, depends_on: str) -> bool:
    """Whether adding this edge closes a cycle, without adding it."""

    if task_id == depends_on:
        return True
    seen = {depends_on}
    frontier = [depends_on]
    while frontier:
        current = frontier.pop()
        if current == task_id:
            return True
        for nxt in by_id.get(current, None).dependencies if current in by_id else ():
            if nxt not in seen:
                seen.add(nxt)
                frontier.append(nxt)
    return False


def add_dependency(tasks: Iterable[Task], task_id: str, depends_on: str) -> tuple[Task, ...]:
    """Add one edge, refusing anything that would make the graph unrunnable."""

    by_id = _graph(tasks)
    for name, value in (("task", task_id), ("dependency", depends_on)):
        if value not in by_id:
            raise DependencyRefused(f"{name} {value} does not exist")
    if by_id[task_id].user_id != by_id[depends_on].user_id:
        raise DependencyRefused("a dependency may not cross an owner")
    if depends_on in by_id[task_id].dependencies:
        return tuple(by_id.values())
    if would_cycle(by_id, task_id, depends_on):
        raise DependencyRefused(
            f"{task_id} depending on {depends_on} would close a cycle"
        )
    updated = by_id[task_id]
    from dataclasses import replace

    by_id[task_id] = replace(
        updated, dependencies=updated.dependencies + (depends_on,)
    )
    return tuple(by_id.values())


def is_blocked(task: Task, by_id: Mapping[str, Task]) -> bool:
    """Whether anything this task waits on is still open.

    A dropped dependency does not block: dropping something is a decision that
    it will not happen, and leaving its dependents blocked forever turns that
    decision into a quiet deletion of other work.
    """

    for dependency in task.dependencies:
        other = by_id.get(dependency)
        if other is None:
            # An unknown dependency blocks. The alternative is treating a
            # missing row as satisfied, which makes deleting a task a way to
            # unblock everything that waited on it.
            return True
        if other.status is not Status.DONE and other.status is not Status.DROPPED:
            return True
    return False


def blockers(task: Task, by_id: Mapping[str, Task]) -> tuple[str, ...]:
    """Which dependencies are the reason, so the answer can be shown."""

    return tuple(
        dependency
        for dependency in task.dependencies
        if dependency not in by_id
        or by_id[dependency].status not in (Status.DONE, Status.DROPPED)
    )


def ready(tasks: Iterable[Task]) -> tuple[Task, ...]:
    """Open tasks nothing is holding up, in the order given."""

    by_id = check(tasks)
    return tuple(
        task
        for task in by_id.values()
        if task.status is Status.OPEN and not is_blocked(task, by_id)
    )
