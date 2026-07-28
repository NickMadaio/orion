# Orion Mac Bridge

The bridge is the native macOS capability boundary for Orion. It accepts line-delimited JSON requests on standard input and returns line-delimited JSON responses on standard output.

It owns requests for Notifications, Reminders, Calendar, and supported Shortcuts actions. The Python runtime remains responsible for planning, permissions, tasks, and audit history.

The native Clock app has no direct public timer API. The supported path is an Apple Shortcut named `Orion Native Timer` containing the Clock **Set Timer** action. Configure its timer duration to use **Shortcut Input**; Orion passes the requested duration as whole seconds. Orion can run that shortcut after it is created and permissioned once.

## Accessibility

Accessibility is a separate, opt-in permission for future computer-control actions such as controlling another app's interface. It is never needed for normal local files, timers, notifications, Calendar, or Reminders. The bridge reports its current status and can open the appropriate macOS permission prompt only after an explicit request from Orion's interface.

## Calendar and Reminders

Orion can request separate read permissions for Calendar and Reminders, then read the next week of calendar events or incomplete reminders locally through EventKit. It does not create, edit, send, or delete any Calendar or Reminders data through this bridge.

## Background runtime

`../launchd/com.nickmadaio.orion.plist` is the macOS LaunchAgent definition for keeping Orion's local runtime available after its browser window or terminal closes. It uses the project-local virtual environment and writes only a local runtime log under Orion's `data` folder.
