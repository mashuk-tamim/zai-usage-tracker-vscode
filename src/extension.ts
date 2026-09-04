import * as vscode from 'vscode';
import * as https from 'https';

let statusBarItem: vscode.StatusBarItem;
let refreshInterval: NodeJS.Timeout | null = null;
let lastParsedData: any = null;

export async function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'zaiUsageTracker.showDetails';
  context.subscriptions.push(statusBarItem);

  // Configure instant hover delay (100ms instead of 500ms default)
  try {
    const hoverConfig = vscode.workspace.getConfiguration('workbench');
    const currentDelay = hoverConfig.get<number>('hover.delay');
    if (currentDelay === undefined || currentDelay >= 300) {
      await hoverConfig.update('hover.delay', 100, vscode.ConfigurationTarget.Global);
    }
  } catch {}

  // Attempt to migrate old key if present in plaintext config
  const oldKey = vscode.workspace.getConfiguration('zaiUsageTracker').get<string>('apiKey');
  if (oldKey) {
    await context.secrets.store('apiKey', oldKey);
    await vscode.workspace.getConfiguration('zaiUsageTracker').update('apiKey', undefined, vscode.ConfigurationTarget.Global);
  }

  // 0. Show Details (Instant QuickPick modal on status bar click)
  const showDetailsCommand = vscode.commands.registerCommand('zaiUsageTracker.showDetails', () => {
    showDetailsQuickPick(context);
  });

  // 1. Setup Wizard (Full setup on first install or manual launch)
  const setupWizardCommand = vscode.commands.registerCommand('zaiUsageTracker.setupWizard', async () => {
    await runSetupWizard(context);
  });

  // 2. Refresh Usage
  const refreshCommand = vscode.commands.registerCommand('zaiUsageTracker.refresh', () => {
    updateUsageData(context);
  });
  
  // 3. Configure API Key
  const configureCommand = vscode.commands.registerCommand('zaiUsageTracker.configureApiKey', async () => {
    const saved = await promptForApiKey(context);
    if (saved) {
      vscode.window.showInformationMessage('Z.ai API Key saved!');
      // Prompt user to configure timezone immediately after configuring API key
      const tzAction = await vscode.window.showInformationMessage(
        'API Key saved. Would you like to configure your timezone now?',
        'Configure Timezone',
        'Keep Current'
      );
      if (tzAction === 'Configure Timezone') {
        await promptForTimezone();
      }
      updateUsageData(context);
    }
  });

  // 4. Configure Timezone
  const configureTimezoneCommand = vscode.commands.registerCommand('zaiUsageTracker.configureTimezone', async () => {
    const changed = await promptForTimezone();
    if (changed) {
      const tz = vscode.workspace.getConfiguration('zaiUsageTracker').get<string>('timezone') || 'Asia/Dhaka';
      vscode.window.showInformationMessage(`Z.ai Timezone set to: ${tz}`);
      updateUsageData(context);
    }
  });

  // 5. Select Time Format (12h / 24h)
  const selectTimeFormatCommand = vscode.commands.registerCommand('zaiUsageTracker.selectTimeFormat', async () => {
    const changed = await promptForTimeFormat();
    if (changed) {
      const fmt = vscode.workspace.getConfiguration('zaiUsageTracker').get<string>('timeFormat') || '12h';
      vscode.window.showInformationMessage(`Z.ai Time Format set to ${fmt}`);
      updateUsageData(context);
    }
  });

  // 6. Configure Refresh Interval
  const configureIntervalCommand = vscode.commands.registerCommand('zaiUsageTracker.configureRefreshInterval', async () => {
    const changed = await promptForRefreshInterval();
    if (changed) {
      const mins = vscode.workspace.getConfiguration('zaiUsageTracker').get<number>('refreshIntervalMinutes') || 5;
      vscode.window.showInformationMessage(`Z.ai Refresh interval set to ${mins} minute(s)!`);
      scheduleRefresh(context);
    }
  });

  context.subscriptions.push(
    showDetailsCommand,
    setupWizardCommand,
    refreshCommand,
    configureCommand,
    configureTimezoneCommand,
    selectTimeFormatCommand,
    configureIntervalCommand
  );

  // Initial fetch
  updateUsageData(context);

  // First installation welcome notification if no API key configured yet
  checkFirstInstall(context);

  // Listen for config changes
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('zaiUsageTracker.timezone') || 
        e.affectsConfiguration('zaiUsageTracker.timeFormat') || 
        e.affectsConfiguration('zaiUsageTracker.refreshIntervalMinutes')) {
      updateUsageData(context);
      scheduleRefresh(context);
    }
  }));

  scheduleRefresh(context);
}

async function checkFirstInstall(context: vscode.ExtensionContext) {
  const apiKey = await context.secrets.get('apiKey');
  if (!apiKey) {
    const prompted = context.globalState.get<boolean>('setupPrompted');
    if (!prompted) {
      await context.globalState.update('setupPrompted', true);
      const start = await vscode.window.showInformationMessage(
        'Welcome to Z.ai Usage Tracker! Configure your API key and timezone to start monitoring your quotas.',
        'Start Setup Wizard',
        'Later'
      );
      if (start === 'Start Setup Wizard') {
        await runSetupWizard(context);
      }
    }
  }
}

async function runSetupWizard(context: vscode.ExtensionContext) {
  // Step 1: API Key
  const keySaved = await promptForApiKey(context);
  const currentKey = await context.secrets.get('apiKey');
  if (!keySaved && !currentKey) {
    vscode.window.showWarningMessage('Z.ai Setup cancelled: API key is required.');
    return;
  }

  // Step 2: Timezone
  await promptForTimezone();

  // Step 3: Time Format
  await promptForTimeFormat();

  // Step 4: Refresh Interval
  await promptForRefreshInterval();

  vscode.window.showInformationMessage('🎉 Z.ai Usage Tracker configured successfully! Tracking is now active.');
  scheduleRefresh(context);
  updateUsageData(context);
}

async function promptForApiKey(context: vscode.ExtensionContext): Promise<boolean> {
  const currentKey = await context.secrets.get('apiKey');
  const apiKey = await vscode.window.showInputBox({
    title: 'Z.ai: Configure API Key (Step 1/4)',
    prompt: 'Enter your Z.ai API Key (from https://z.ai/manage-apikey/apikey-list)',
    value: currentKey ? '••••••••••••••••' : '',
    password: true,
    ignoreFocusOut: true,
    validateInput: (val) => {
      if (!val || val.trim().length === 0) {
        return 'API Key cannot be empty.';
      }
      return null;
    }
  });

  if (!apiKey || (currentKey && apiKey === '••••••••••••••••')) {
    return false;
  }

  await context.secrets.store('apiKey', apiKey.trim());
  return true;
}

async function promptForTimezone(): Promise<boolean> {
  let localTz = 'UTC';
  try {
    localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {}

  const currentTz = vscode.workspace.getConfiguration('zaiUsageTracker').get<string>('timezone') || 'Asia/Dhaka';

  const timezoneItems: (vscode.QuickPickItem & { tzValue?: string; isCustom?: boolean })[] = [
    {
      label: '$(star) Asia/Dhaka',
      description: 'UTC+6 — Bangladesh Standard Time (Recommended)',
      tzValue: 'Asia/Dhaka'
    },
    {
      label: `$(device-desktop) Local Timezone (${localTz})`,
      description: 'Uses your system local timezone',
      tzValue: localTz
    },
    {
      label: 'Asia/Shanghai',
      description: 'UTC+8 — Beijing / China Standard Time (Dashboard Default)',
      tzValue: 'Asia/Shanghai'
    },
    {
      label: 'Asia/Singapore',
      description: 'UTC+8 — Singapore Standard Time',
      tzValue: 'Asia/Singapore'
    },
    {
      label: 'Asia/Kolkata',
      description: 'UTC+5:30 — India Standard Time',
      tzValue: 'Asia/Kolkata'
    },
    {
      label: 'UTC',
      description: 'Coordinated Universal Time',
      tzValue: 'UTC'
    },
    {
      label: 'Europe/London',
      description: 'UTC+0 / UTC+1 — London (GMT/BST)',
      tzValue: 'Europe/London'
    },
    {
      label: 'America/New_York',
      description: 'UTC-5 / UTC-4 — US Eastern Time (EST/EDT)',
      tzValue: 'America/New_York'
    },
    {
      label: 'America/Los_Angeles',
      description: 'UTC-8 / UTC-7 — US Pacific Time (PST/PDT)',
      tzValue: 'America/Los_Angeles'
    },
    {
      label: 'Asia/Tokyo',
      description: 'UTC+9 — Japan Standard Time',
      tzValue: 'Asia/Tokyo'
    },
    {
      label: '$(pencil) Enter custom IANA Timezone...',
      description: 'e.g. America/Chicago, Europe/Berlin, Australia/Sydney',
      isCustom: true
    }
  ];

  const picked = await vscode.window.showQuickPick(timezoneItems, {
    title: 'Z.ai: Configure Timezone (Step 2/4)',
    placeHolder: `Current: ${currentTz}. Select a timezone for reset timestamps:`
  });

  if (!picked) return false;

  let chosenTz = picked.tzValue;
  if (picked.isCustom) {
    const custom = await vscode.window.showInputBox({
      title: 'Z.ai: Enter Custom Timezone',
      prompt: 'Enter a valid IANA timezone identifier (e.g. America/Chicago, Europe/Paris, Asia/Dubai)',
      value: currentTz,
      validateInput: (val) => {
        if (!val || val.trim().length === 0) return 'Timezone cannot be empty.';
        try {
          Intl.DateTimeFormat(undefined, { timeZone: val.trim() });
          return null;
        } catch {
          return 'Invalid IANA timezone identifier. Examples: Asia/Dhaka, Europe/Berlin, America/Toronto.';
        }
      }
    });
    if (!custom) return false;
    chosenTz = custom.trim();
  }

  if (chosenTz) {
    await vscode.workspace.getConfiguration('zaiUsageTracker').update('timezone', chosenTz, vscode.ConfigurationTarget.Global);
    return true;
  }
  return false;
}

async function promptForTimeFormat(): Promise<boolean> {
  const currentFormat = vscode.workspace.getConfiguration('zaiUsageTracker').get<string>('timeFormat') || '12h';
  const selected = await vscode.window.showQuickPick([
    { label: '12h', description: '12-hour format with AM/PM (e.g. 01:14 PM)' },
    { label: '24h', description: '24-hour military format (e.g. 13:14)' }
  ], {
    title: 'Z.ai: Select Time Format (Step 3/4)',
    placeHolder: `Current: ${currentFormat}. Select time display format for timestamps:`
  });

  if (selected) {
    await vscode.workspace.getConfiguration('zaiUsageTracker').update('timeFormat', selected.label, vscode.ConfigurationTarget.Global);
    return true;
  }
  return false;
}

async function promptForRefreshInterval(): Promise<boolean> {
  const current = vscode.workspace.getConfiguration('zaiUsageTracker').get<number>('refreshIntervalMinutes') || 5;
  const picked = await vscode.window.showQuickPick([
    { label: '5 minutes', description: 'Recommended balance of freshness and efficiency', mins: 5 },
    { label: '1 minute', description: 'Frequent real-time quota updates', mins: 1 },
    { label: '15 minutes', description: 'Low background network usage', mins: 15 },
    { label: '30 minutes', description: 'Periodic background check', mins: 30 },
    { label: '60 minutes', description: 'Once per hour', mins: 60 },
    { label: '$(pencil) Custom minutes...', description: 'Specify between 1 and 1440 minutes', mins: -1 }
  ], {
    title: 'Z.ai: Refresh Interval (Step 4/4)',
    placeHolder: `Current: ${current} min. Choose background refresh interval:`
  });

  if (!picked) return false;

  let mins = picked.mins;
  if (mins === -1) {
    const input = await vscode.window.showInputBox({
      title: 'Z.ai: Custom Refresh Interval',
      prompt: 'Enter interval in minutes (1 to 1440)',
      value: String(current),
      validateInput: (val) => {
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 1 || num > 1440) {
          return 'Enter a valid number between 1 and 1440.';
        }
        return null;
      }
    });
    if (!input) return false;
    mins = parseInt(input, 10);
  }

  await vscode.workspace.getConfiguration('zaiUsageTracker').update('refreshIntervalMinutes', mins, vscode.ConfigurationTarget.Global);
  return true;
}

function scheduleRefresh(context: vscode.ExtensionContext) {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  const rawMinutes = vscode.workspace.getConfiguration('zaiUsageTracker').get<number>('refreshIntervalMinutes') || 5;
  const minutes = Math.max(1, Math.min(1440, rawMinutes));
  refreshInterval = setInterval(() => updateUsageData(context), minutes * 60 * 1000);
}

async function updateUsageData(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('zaiUsageTracker');
  const apiKey = await context.secrets.get('apiKey');

  if (!apiKey) {
    statusBarItem.text = `$(key) Z.ai: Setup API Key`;
    statusBarItem.tooltip = 'Click to run the Z.ai setup wizard';
    statusBarItem.command = 'zaiUsageTracker.setupWizard';
    statusBarItem.show();
    return;
  }

  statusBarItem.text = `$(sync~spin) Z.ai: Syncing...`;
  statusBarItem.show();

  try {
    const data = await fetchUsageData(apiKey);
    const parsed = parseQuotaResponse(data);
    
    lastParsedData = parsed;
    statusBarItem.command = 'zaiUsageTracker.showDetails';

    // Status bar text shows 5h and weekly percentage
    const sessionPct = parsed.sessionLimit ? Math.round(parsed.sessionLimit.percentage) : 0;
    const weeklyPct = parsed.weeklyLimit ? Math.round(parsed.weeklyLimit.percentage) : null;
    statusBarItem.text = weeklyPct !== null 
      ? `$(pulse) Z.ai: ${sessionPct}% (5h) | W: ${weeklyPct}%`
      : `$(pulse) Z.ai: ${sessionPct}% (5h)`;
    
    // Tooltip shows detailed breakdown
    const tz = config.get<string>('timezone') || 'Asia/Dhaka';
    const timeFormat = config.get<string>('timeFormat') || '12h';
    statusBarItem.tooltip = buildTooltip(parsed, tz, timeFormat);

  } catch (error: any) {
    statusBarItem.text = `$(error) Z.ai: Error`;
    statusBarItem.tooltip = error.message;
    console.error('Z.ai Usage Tracker Error:', error);
  }
}

function fetchUsageData(apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.z.ai',
      path: '/api/monitor/usage/quota/limit',
      method: 'GET',
      timeout: 10000,
      headers: {
        'Authorization': apiKey,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else if (res.statusCode === 401 && !options.headers['Authorization'].startsWith('Bearer ')) {
           // Try Bearer token if raw key fails
           options.headers['Authorization'] = `Bearer ${apiKey}`;
           const req2 = https.request(options, (res2) => {
             let data2 = '';
             res2.on('data', chunk => data2 += chunk);
             res2.on('end', () => {
               if (res2.statusCode === 200) {
                 try {
                   resolve(JSON.parse(data2));
                 } catch (e) {
                   reject(new Error('Invalid JSON response'));
                 }
               } else {
                 reject(new Error(`HTTP ${res2.statusCode}`));
               }
             });
           });
           req2.on('timeout', () => {
             req2.destroy();
             reject(new Error('Request timed out'));
           });
           req2.on('error', reject);
           req2.end();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

function parseQuotaResponse(response: any) {
  if (!response || response.success === false || !response.data || !Array.isArray(response.data.limits)) {
    throw new Error('Invalid quota response structure');
  }

  let sessionLimit: any = null;
  let weeklyLimit: any = null;
  let mcpLimit: any = null;

  for (const raw of response.data.limits) {
    if (!raw) continue;
    const multipliers: { [key: number]: number } = { 1: 1440, 3: 60, 5: 1, 6: 10080 };
    const windowMinutes = (raw.number > 0 && multipliers[raw.unit]) ? raw.number * multipliers[raw.unit] : null;
    
    const parsedItem = {
      type: raw.type,
      percentage: raw.percentage || 0,
      currentValue: raw.currentValue || 0,
      usage: raw.usage || 0,
      windowMinutes,
      nextResetTime: raw.nextResetTime ? Number(raw.nextResetTime) : null
    };

    if (raw.type === 'TIME_LIMIT') {
      mcpLimit = parsedItem;
    } else if (raw.type === 'TOKENS_LIMIT' || raw.type === 'CREDIT_LIMIT') {
      if (windowMinutes === 300 || (raw.unit === 3 && raw.number === 5)) {
        sessionLimit = parsedItem;
      } else if (windowMinutes === 10080 || raw.unit === 6) {
        weeklyLimit = parsedItem;
      } else if (!sessionLimit) {
        sessionLimit = parsedItem;
      } else if (!weeklyLimit) {
        weeklyLimit = parsedItem;
      }
    }
  }

  let planTier = response.data.planName || response.data.plan;
  if (!planTier && response.data.level) {
    planTier = `GLM ${response.data.level.charAt(0).toUpperCase() + response.data.level.slice(1)} Plan`;
  }
  if (!planTier) planTier = 'GLM Lite Plan';

  return {
    planTier,
    sessionLimit,
    weeklyLimit,
    mcpLimit
  };
}

function formatNumber(num: number) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return String(num);
}

function buildTooltip(parsed: any, timezone: string, timeFormat: string = '12h'): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  md.appendMarkdown(`**${parsed.planTier} Usage**\n\n`);

  if (parsed.sessionLimit) {
    const s = parsed.sessionLimit;
    const unit = s.type === 'CREDIT_LIMIT' ? 'Credits' : 'Tokens';
    md.appendMarkdown(`**5-Hour Limit**  \n`);
    md.appendMarkdown(`**${Math.round(s.percentage)}% Used** &nbsp; ${unit}: ${formatNumber(s.currentValue)} / ${formatNumber(s.usage)}  \n`);
    if (s.nextResetTime) {
      md.appendMarkdown(`**Reset Time:** ${formatDate(s.nextResetTime, timezone, timeFormat)}\n\n`);
    } else {
      md.appendMarkdown('\n');
    }
  }

  if (parsed.weeklyLimit) {
    const w = parsed.weeklyLimit;
    const unit = w.type === 'CREDIT_LIMIT' ? 'Credits' : 'Tokens';
    md.appendMarkdown(`**Weekly Limit**  \n`);
    md.appendMarkdown(`**${Math.round(w.percentage)}% Used** &nbsp; ${unit}: ${formatNumber(w.currentValue)} / ${formatNumber(w.usage)}  \n`);
    if (w.nextResetTime) {
      md.appendMarkdown(`**Reset Time:** ${formatDate(w.nextResetTime, timezone, timeFormat)}\n\n`);
    } else {
      md.appendMarkdown('\n');
    }
  }

  if (parsed.mcpLimit) {
    const m = parsed.mcpLimit;
    md.appendMarkdown(`**MCP Tool Calls**  \n`);
    md.appendMarkdown(`**${Math.round(m.percentage)}% Used** &nbsp; Calls: ${m.currentValue} / ${m.usage}\n\n`);
  }

  md.appendMarkdown(`• Click status bar item for instant details & actions\n`);

  return md;
}

function formatDate(epochMs: number, timezone: string, timeFormat: string = '12h'): string {
  try {
    const tzOption = timezone === 'local' ? undefined : timezone;
    const is24h = timeFormat === '24h';
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzOption,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: is24h ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !is24h
    });
    return formatter.format(new Date(epochMs));
  } catch (e) {
    return new Date(epochMs).toLocaleString();
  }
}

async function showDetailsQuickPick(context: vscode.ExtensionContext) {
  if (!lastParsedData) {
    updateUsageData(context);
    return;
  }
  const config = vscode.workspace.getConfiguration('zaiUsageTracker');
  const tz = config.get<string>('timezone') || 'Asia/Dhaka';
  const timeFormat = config.get<string>('timeFormat') || '12h';

  const items: vscode.QuickPickItem[] = [];

  items.push({
    label: `$(info) ${lastParsedData.planTier} Details`,
    kind: vscode.QuickPickItemKind.Separator
  });

  if (lastParsedData.sessionLimit) {
    const s = lastParsedData.sessionLimit;
    const unit = s.type === 'CREDIT_LIMIT' ? 'Credits' : 'Tokens';
    const resetStr = s.nextResetTime ? formatDate(s.nextResetTime, tz, timeFormat) : '5h rolling window';
    items.push({
      label: `$(pulse) 5-Hour Limit: ${Math.round(s.percentage)}% Used`,
      description: `${formatNumber(s.currentValue)} / ${formatNumber(s.usage)} ${unit}`,
      detail: `Reset Time: ${resetStr}`
    });
  }

  if (lastParsedData.weeklyLimit) {
    const w = lastParsedData.weeklyLimit;
    const unit = w.type === 'CREDIT_LIMIT' ? 'Credits' : 'Tokens';
    const resetStr = w.nextResetTime ? formatDate(w.nextResetTime, tz, timeFormat) : 'Weekly refresh';
    items.push({
      label: `$(calendar) Weekly Limit: ${Math.round(w.percentage)}% Used`,
      description: `${formatNumber(w.currentValue)} / ${formatNumber(w.usage)} ${unit}`,
      detail: `Reset Time: ${resetStr}`
    });
  }

  if (lastParsedData.mcpLimit) {
    const m = lastParsedData.mcpLimit;
    items.push({
      label: `$(tools) MCP Tool Calls: ${Math.round(m.percentage)}% Used`,
      description: `${m.currentValue} / ${m.usage} calls`
    });
  }

  items.push({
    label: 'Actions',
    kind: vscode.QuickPickItemKind.Separator
  });

  items.push(
    { label: '$(refresh) Refresh Usage Now', description: 'Fetch latest usage from Z.ai' },
    { label: '$(globe) Configure Timezone', description: `Current: ${tz}` },
    { label: '$(gear) Setup / Full Configuration Wizard', description: 'Configure API key, timezone, and format' }
  );

  const selected = await vscode.window.showQuickPick(items, {
    title: `${lastParsedData.planTier} — Quota & Reset Breakdown`,
    placeHolder: 'Select an action or press Escape to close'
  });

  if (selected) {
    if (selected.label.includes('Refresh Usage')) {
      updateUsageData(context);
    } else if (selected.label.includes('Configure Timezone')) {
      vscode.commands.executeCommand('zaiUsageTracker.configureTimezone');
    } else if (selected.label.includes('Setup / Full Configuration')) {
      vscode.commands.executeCommand('zaiUsageTracker.setupWizard');
    }
  }
}

export function deactivate() {
  if (refreshInterval) clearInterval(refreshInterval);
}
