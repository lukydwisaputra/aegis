---
topic: mobile-testing
sources:
  - book: full-stack-testing-mohan
    chapters: [11]
    role: primary
  - book: practical-playwright-greffier
    chapters: [8]
    role: complementary
ingestedAt: "2026-05-24"
---

# Mobile Testing (Synthesis)

> Mobile testing has a distinct CFR set with no web equivalent: device fragmentation, gesture vocabularies, hardware-sensor dependencies, network variability, battery constraints, and OS-lifecycle interruptions. Browser device emulation (Playwright) is a fast complement during development but cannot replace real-device testing for a release candidate.

## App architecture types

Mobile apps fall into four architectures, each with distinct testing scope and tool selection (full-stack-testing-mohan ch-11).

### Native (Android Java/Kotlin, iOS Swift/Objective-C)

Built for a single OS using platform-native languages, distributed through app stores.

- **Pros:** best runtime performance; full OS API and hardware access; offline support; consistent platform look-and-feel.
- **Cons:** separate codebase per platform; urgent fixes must pass store review before reaching users.
- **Testing implications:** Espresso (Android) and XCUITest (iOS) for in-platform testing; Appium for cross-platform suites. Gestures, sensors, and battery behavior require real hardware.

### Mobile web (responsive web in mobile browser)

Standard web applications accessed through a mobile browser; no installation required.

- **Pros:** OS-independent; no store approval; reuses web automation skills.
- **Cons:** no OS-level feature access (camera, contacts); no offline support; constrained UX.
- **Testing implications:** Chrome DevTools responsive mode and Playwright device emulation cover most exploratory and functional needs without a device farm (practical-playwright-greffier ch-08).

### Hybrid (WebView wrapped in native shell)

Web content wrapped in a native container using React Native, Ionic, Cordova, or Flutter.

- **Pros:** single codebase across platforms; lower development cost; web-layer updates bypass store review.
- **Cons:** inferior performance to native; cross-platform feel can be inconsistent.
- **Testing implications:** Appium covers both the native shell and embedded WebView; OS-specific rendering differences require device testing.

### PWA (Progressive Web App)

Mobile web app installable from a URL with push notifications, offline access, and limited OS feature access.

- **Pros:** near-native performance; cross-OS; smallest storage footprint; lowest cost. Twitter's 2017 PWA migration yielded 20% lower bounce rate, 75% more tweets, and 65% more pages per session.
- **Cons:** ecosystem less mature than native; some OS integrations remain limited.
- **Testing implications:** no store-installation flow to test; web automation tools apply with added offline and push scenarios.

---

## The three mobile testing lenses

Mobile complexity originates from three interconnected dimensions that must be considered together (full-stack-testing-mohan ch-11).

### Devices

- **Screen size, density, resolution:** Android density tiers (LDPI through XXXHDPI) require images authored per tier; auto-resizing causes blur. Resolution describes absolute pixels; density describes sharpness.
- **OS fragmentation:** Android and iOS hold ~99% global market share, but each OS supports multiple simultaneous versions. As of 2020, Android 6.0 (2015) was still the second-most-used Android version. Selecting only flagship devices and latest OS leaves a large slice of users untested.
- **Hardware variation:** RAM, CPU, battery capacity, storage, GPS, camera, and sensors differ by model and constrain app behavior.
- **Manufacturer customizations:** Samsung, Oppo, Xiaomi, Motorola, Google ship custom Android variants and differ in hardware layout (back/home buttons).

### Apps

Beyond click-and-type, mobile apps support a rich gesture vocabulary: swipe, touch, long press, pinch-to-zoom, press-and-drag, rotate. App-wide gestures (e.g., swipe-left to open navigation drawer) become cross-cutting CFRs that must be tested for every story.

### Network

Network quality is unequal globally. The app must be tested under:
- 2G, 3G, 4G, WiFi, and fully offline.
- Network oscillation (switching between types mid-session).
- Timeout and error handling on connectivity loss.
- App launch performance under bandwidth constraints.

Facebook Lite is the canonical example of designing for 2G and unstable connections.

---

## Device selection strategy: 85% coverage goal

Testing every device permutation is infeasible. The goal is at least 85% coverage of the target customer segment (full-stack-testing-mohan ch-11). Filter device choices with four questions:

1. Who is the target customer segment, and what device class do they own?
2. Which markets/countries are in scope, and who are the dominant OS vendors there?
3. If an existing product is live, which devices already drive traffic?
4. What is the expected network bandwidth range in target markets?

Output: three to four primary handsets plus a few supplementary devices for bug bashes.

### Device access options

- **Local physical devices:** authoritative for gestures, sensors, battery; expensive at scale.
- **Emulators (Android Studio AVD) / simulators (Xcode):** free, fast feedback during development; cannot fully replicate touch gestures, hardware sensor integrations, or battery behavior.
- **Cloud device farms:** AWS Device Farm, Firebase Test Lab, BrowserStack, Sauce Labs, Perfecto. Broad coverage without purchase cost; interactions can be slower; ongoing subscription cost.

Both Apple and Google explicitly recommend real-device testing before release. Emulators are insufficient as the sole environment for a release candidate.

**Shift-left tip:** developers can use the most challenging density (LDPI/MDPI) during development; the BA, QA, and developer can each cover one device version during dev-box testing; automated tests run on the selected device set in CI.

---

## Playwright device emulation as a complement

For mobile web and PWA testing, Playwright provides layered emulation controls that cover most functional needs at developer speed (practical-playwright-greffier ch-08).

A Playwright "device" is a named bundle of characteristics:

| Property | Purpose |
|---|---|
| `userAgent` | Sent as HTTP header and exposed to `navigator.userAgent` |
| `viewport` | Usable page area; controls actual layout space |
| `screen` | Reported screen size (`window.screen`) |
| `deviceScaleFactor` | Physical-to-CSS pixel ratio; affects image sharpness |
| `isMobile` | Whether `<meta name="viewport">` is respected |
| `hasTouch` | Whether touch events are synthesized |
| `defaultBrowserType` | Browser engine to pair with (chromium / firefox / webkit) |

`isMobile` and `hasTouch` are separate because a laptop can have a touchscreen.

Usage at project level:

```ts
projects: [
  {
    name: 'Mobile Chrome',
    use: { ...devices['Pixel 5'] },
  },
],
```

Per test file: `test.use({ ...devices['iPhone 11'] });`

### What Playwright emulation cannot replicate

- Dynamic browser chrome (collapsing mobile nav bars).
- CSS safe-area insets for notches and Dynamic Island.
- Multi-touch gestures.
- Subtle rendering engine differences from real WebKit/Chromium on mobile.
- Battery-saving behaviors and real hardware power management.

Playwright emulation is appropriate for functional tests; real-device or device-farm testing is still required for pixel-perfect visual validation, hardware-behavior coverage, and release-candidate sign-off.

### CPU throttling via CDP (Chromium only)

```ts
const client = await page.context().newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
```

Throttling 4x simulates low-end device CPU, allowing performance budgets to be validated for slower hardware without a physical device.

### Geolocation, locale, timezone

```ts
test.use({
  geolocation: { latitude: -1.6778, longitude: 48.1173 },
  permissions: ['geolocation'],
  locale: 'en-GB',
  timezoneId: 'Europe/Paris',
});
```

Geolocation only spoofs the browser Geolocation API — server-side IP-based geo-fencing is unaffected.

---

## Mobile testing strategy by dimension

### Manual exploratory testing

Exploratory testing is especially important because the combinatorial device/app/network space cannot be enumerated. Apply the three lenses (device, app, network) systematically. Chrome DevTools responsive mode is sufficient for mobile web; emulators/simulators or physical devices are required for native and hybrid (full-stack-testing-mohan ch-11).

### Functional automated testing

| Tool | Platforms | App types | Notes |
|---|---|---|---|
| **Appium** | Android + iOS | Native, hybrid, mobile web | Cross-platform; WebDriver-compatible; wraps XCUITest and UiAutomator2 |
| **Espresso** | Android only | Native only | Google-provided; integrated with Android Studio; supports a11y scanning |
| **XCUITest** | iOS only | Native only | Apple-provided; integrated with Xcode |
| **Playwright** | Mobile web (emulated) | Mobile web, PWA | Device emulation via `devices['…']`; complements but does not replace real devices |

Page Object Model applies to mobile UI tests exactly as to web tests. Appium 2.0 requires OS-specific drivers (UiAutomator2, XCUITest) and plug-ins to be installed separately.

### Data testing

Mobile data spans multiple storage layers (full-stack-testing-mohan ch-11):
- **Local mobile database:** stale-data behavior offline, volume limits, sync with central DB, multi-device conflicts.
- **Common (central) database:** cross-device transaction reconciliation (calendar sync is the canonical example).
- **Local device storage:** storage-full scenarios, external storage unavailability, OS file-format limits.

Data sync — bidirectional between central and local DBs under variable network — is a critical and underestimated area.

### Visual testing

- **Manual visual testing** during device testing (distribute devices across team members at story level).
- **Appium + Applitools Eyes:** AI-powered visual regression; full-page comparison without scripting.
- **Appium 2.0 visual plug-in:** OpenCV-based; baseline + similarity score with configurable threshold (typically 0.99).

### Security testing

- **Static analysis:** scan binary and source for vulnerabilities.
- **Dynamic analysis:** inject known attacks at runtime.
- **OWASP Mobile Top 10:** mandatory reference; OWASP Mobile Security Testing Guide is the maintained community resource.
- **Tools:** MobSF (open source, Docker-based, web UI; Android/iOS/Windows; static + dynamic; integrated into GitLab SAST), Qark (Android, static).

### Performance testing

Two distinct dimensions:

**Resource consumption** — CPU, memory, battery, network bandwidth. Battery is a mobile-specific constraint with no web equivalent.

**Response time:**
- App launch: under 5 seconds.
- In-app responses: under 3 seconds; bounce rate rises sharply past this.
- Network calls dominate response time; simulate varied network conditions.

| Tool | Platform | What it measures |
|---|---|---|
| Android Profiler | Android | CPU, memory, battery, network in IDE |
| Xcode Instruments | iOS | CPU, memory, battery, network |
| Appium Performance API | Android | `cpuinfo`, `memoryinfo`, `batteryinfo`, `networkinfo` via `dumpsys` |
| Android Monkey | Android | Stress test (random events); `adb shell monkey -p <pkg> -v 2000` |
| Emulator network throttler | Android emulator | GSM/GPRS/Edge/LTE simulation |

### Accessibility testing

Same WCAG 2.0 POUR principles as web; mobile-specific concerns include pinch-to-zoom, small-screen readability, minimum touch target sizes, and critical elements within viewport without scrolling.

- **iOS:** VoiceOver (screen reader); Xcode Accessibility Inspector.
- **Android (shift-left order):** Android Studio lint warnings → Espresso a11y scanning → TalkBack → Accessibility Scanner → Switch Access / BrailleBack / Voice Access → Google Play pre-launch a11y audit.

### Mobile-specific CFRs

**Interruptions** (cross-cutting; test every story):
- In-progress request when app moves to background?
- Authentication session when paused and resumed?
- Network request when app is killed?
- Battery depletion during a critical workflow?

**Installability and upgradability:**
- Test installation across target devices and OS versions from respective stores.
- Failure modes: insufficient storage, denied permissions, OS version incompatibility.
- Upgrade: local DB schema migration, login persistence, upgrades from older versions (not just N-1), new permission requests.
- Network conditions affect installability and upgrade reliability.
- Test uninstallation.

**Monitoring:**
- Mobile crashes are significantly more common than web crashes.
- Integrate Firebase Crashlytics, Dynatrace, or New Relic into test environments from day one — not just production.

**Usability:**
- Personal device usage varies by handedness, multitasking habits, usage context (driving, walking), language preferences.
- Google's "Think with Google" provides country-level mobile behavior data for usability research.

---

## When emulation is enough, when it isn't

| Goal | Playwright emulation | Real device / cloud farm |
|---|---|---|
| Mobile web functional tests | Sufficient | Optional |
| Responsive layout regression | Sufficient (multi-viewport project) | Spot-check |
| CSS / rendering pixel-perfect | Insufficient | Required |
| Gestures (multi-touch, swipe nuances) | Limited | Required |
| Hardware sensors (GPS, camera) | Insufficient | Required |
| Battery / power consumption | Impossible | Required |
| Real network behavior (2G/3G oscillation) | Throttle-only approximation | Required |
| Pre-release sign-off | Insufficient | Required (Apple/Google guidance) |

Default rule: use Playwright emulation as the per-commit feedback layer for mobile web, and real devices (local or cloud farm) for release-candidate validation.

---

## Pitfalls

- **Testing only on simulators/emulators.** Emulators cannot replicate all touch gestures, sensor behavior, or battery drain. Both Apple and Google recommend real-device testing before release (full-stack-testing-mohan ch-11).
- **Ignoring device fragmentation.** Selecting only latest flagships leaves a large user slice untested. The 85% target coverage rule must drive device selection.
- **Treating WiFi as the standard.** Failing to test 2G/3G/network oscillation yields poor experiences for low-bandwidth users and breaks installation/upgrade/sync reliability.
- **No battery testing.** Apps that drain battery excessively are uninstalled. Battery has no web equivalent and must be measured explicitly.
- **Upgrade testing only from N-1.** Users upgrading from N-2 or N-3 may hit data migration failures, permission prompt changes, or broken schemas invisible when starting from the latest version.
- **Skipping interruption testing.** Treating each story as an isolated flow without testing call/notification/kill/battery interruption leaves a mobile-specific class of bugs undetected.
- **Treating mobile as a small screen.** Mobile introduces gestures, orientation, offline mode, local DB, lifecycle events, hardware sensors, and permissions as first-class concerns — not just smaller layouts (practical-playwright-greffier ch-08).
- **No monitoring integration in test environments.** Crashes are hard to reproduce manually; without Crashlytics/Dynatrace/New Relic active during testing, root cause analysis is largely guesswork.
- **Geolocation spoofing for IP-based geo-fencing.** Playwright's geolocation only affects the browser API. IP-based server-side restrictions require a network-level solution (practical-playwright-greffier ch-08).
- **Default visual threshold of 1.0.** Minor font rendering differences across OS versions cause false failures. Use a project-specific threshold (e.g., 0.99) with a baseline update process.

---

## Agent applicability

- **qa-responsive-specialist:** uses Playwright device emulation as primary tool; escalates to real devices/cloud farms for pixel-perfect and hardware-dependent scenarios.
- **qa-ui-specialist:** owns Appium-based native automation and mobile web E2E in Playwright; aligns mobile selectors with the same `getByRole`-first practices as web.
- **qa-test-planner / qa-orchestrator:** drives the 85% device selection process and decides emulation-vs-real-device split per story.
