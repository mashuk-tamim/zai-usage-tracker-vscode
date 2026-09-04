# Z.ai Usage Tracker for VS Code & Cursor

Track your **Z.ai (GLM) Coding Plan** (Lite, Pro, Max) usage, 5-hour rolling quota, and weekly limits directly from your editor's status bar.

![Status Bar Demo](icon.png)

## Features

- ⚡ **Real-Time Status Bar**: Displays current 5-hour quota usage percentage and time remaining until reset directly in your status bar.
- 🕒 **Dhaka & Custom Timezone Conversion**: Automatically formats quota reset times in your local timezone (defaults to `Asia/Dhaka`).
- ⏱️ **12h / 24h Time Format**: Switch between 12-hour format with AM/PM (e.g., `01:14 PM`) and military 24-hour format (e.g., `13:14`).
- 📊 **Detailed Quota Tooltip**: Hover over the status bar item to see complete breakdowns for:
  - 5-Hour rolling window quota and reset time
  - Weekly quota usage and refresh date
  - MCP tool call limits
- 🔒 **Secure Keychain Storage**: API keys are securely saved using VS Code's encrypted `SecretStorage` API (macOS Keychain, Windows Credential Manager, Linux Secret Service).
- 🔄 **Configurable Refresh Intervals**: Poll for updates automatically every 1 to 1440 minutes.

---

## Setup & Configuration

1. Press `Cmd + Shift + P` (macOS) or `Ctrl + Shift + P` (Windows/Linux).
2. Run command:
   ```text
   Z.ai: Configure API Key
   ```
3. Enter your Z.ai API Key (from [https://z.ai/manage-apikey/apikey-list](https://z.ai/manage-apikey/apikey-list)).
4. The status bar will automatically fetch your active usage and display your stats.

### Extension Settings

Available under **Settings (`Cmd + ,`) > Extensions > Z.ai Usage Tracker**:

- `zaiUsageTracker.timezone`: Timezone for reset time display (default: `Asia/Dhaka`).
- `zaiUsageTracker.timeFormat`: `12h` or `24h` time display format.
- `zaiUsageTracker.refreshIntervalMinutes`: Auto-refresh interval in minutes (default: `5`).

---

## Commands

- `Z.ai: Setup / Full Configuration Wizard` - Guided step-by-step setup (API key, timezone, format, refresh interval).
- `Z.ai: Configure Timezone` - Select your timezone (defaults to `Asia/Dhaka`, local system, or custom IANA).
- `Z.ai: Configure API Key` - Set or update your Z.ai API key (prompts to configure timezone next).
- `Z.ai: Select Time Format (12h / 24h)` - Quick pick for 12-hour AM/PM or 24-hour display.
- `Z.ai: Configure Refresh Interval (minutes)` - Adjust background polling frequency.
- `Z.ai: Refresh Usage` - Manually trigger an immediate quota fetch.

---

## License

[MIT License](https://github.com/mashuk-tamim/zai-usage-tracker-vscode/blob/main/LICENSE)
