# Orion Companion

This is the beginning of Orion's native macOS presence: a lightweight menu-bar app that can open the local control surface and report whether the local runtime is reachable.

It is deliberately separate from the headless Python service. The next iteration will let the signed app own startup, native permissions, and the Swift bridge, which avoids the macOS privacy boundary that affects headless services launched from Desktop.
