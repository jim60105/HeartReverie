# Tasks — fix-poll-rate-limit

## 1. Increase base poll interval
- [x] 1.1 In `reader/js/chapter-nav.js`, add module-level constants `POLL_INTERVAL_BASE = 3000` and `POLL_INTERVAL_MAX = 30000`
- [x] 1.2 Replace all `setInterval(pollBackend, 1000)` calls with `setInterval(pollBackend, POLL_INTERVAL_BASE)`

## 2. Add 429 backoff logic
- [x] 2.1 Add module-level variable `currentPollInterval = POLL_INTERVAL_BASE`
- [x] 2.2 In `pollBackend`, check response status — on 429, double `currentPollInterval` (cap at `POLL_INTERVAL_MAX`), clear existing interval, and restart with the new interval
- [x] 2.3 On successful response, if `currentPollInterval !== POLL_INTERVAL_BASE`, reset it and restart the interval timer
