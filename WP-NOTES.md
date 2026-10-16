# WP notes
- 2026-10-16: phone UI redesign. Chat is home; drawer (PhoneDrawer) holds sections as sheets. New files: ChatMessageViews, ChatComposer, ChatTalkingView, ChatTopBar, PhoneDrawer (pbxproj IDs 0C1001..0C5002). Simulator build OK.
- Builds (sim+device) and swift test pass; screenshots in ORION/docs/design/phone-ui-2026-10-16. simctl wrapper blocked by stale CoreSimulator (used the real simctl binary; unsigned build crashes on CKContainer, screenshots used ad-hoc signed build). Left: AppUITests still reference the old tab bar.
