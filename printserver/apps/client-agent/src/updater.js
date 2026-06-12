/**
 * Auto-update module for PrintServer Node Agent
 *
 * Strategy: every 30 minutes, the running agent asks the server
 *   GET {serverUrl}/downloads/agent/info
 * and compares `version` against its own baked-in CURRENT_VERSION.
 * When the server reports a newer build, the agent:
 *   1. Downloads the proven server-hosted updater script
 *      ({serverUrl}/downloads/update-agent.ps1) — the SAME script that
 *      manage-agent.bat menu [9] runs (stop → download → swap → restart →
 *      verify online).
 *   2. Writes a run-update.cmd launcher next to the exe with all args baked in.
 *   3. Registers + fires a SEPARATE one-shot scheduled task
 *      (PrintServerAgentUpdater) that runs the launcher.
 *   4. Exits so the updater (in its OWN process tree) can swap the exe and
 *      restart the main PrintServerNodeAgent task.
 *
 * Why a separate scheduled task: the agent runs as a SYSTEM scheduled task.
 * A child process spawned by the agent is part of the agent's process tree,
 * so Task Scheduler kills it when the agent exits — which is why the old
 * child-PowerShell bootstrap died mid-swap (agent left STOPPED, version
 * unchanged). A distinct scheduled task survives the agent's exit.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const CURRENT_VERSION = '1.4.1';
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes
const INITIAL_CHECK_DELAY = 60 * 1000;        // wait 1 min after startup

// Files below %APPDATA%\printserver-agent\  (created by installer)
function getInstallDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'printserver-agent');
}
function getExePath() {
  return process.execPath; // pkg-built exe is its own execPath
}

class AutoUpdater {
  constructor({ serverUrl, log }) {
    this.serverUrl = (serverUrl || '').replace(/\/$/, '');
    this.log = log || (() => {});
    this.timer = null;
    this.inProgress = false;
  }

  start() {
    if (!this.serverUrl) {
      this.log('warn', '[Updater] serverUrl not set, auto-update disabled');
      return;
    }
    if (process.pkg === undefined) {
      // Running unpackaged (node src/index.js) — skip update, would just
      // overwrite dev sources.
      this.log('info', '[Updater] Running unpackaged, auto-update disabled');
      return;
    }
    this.log('info', `[Updater] Auto-update enabled (current v${CURRENT_VERSION}, check every ${UPDATE_CHECK_INTERVAL/60000} min)`);
    setTimeout(() => this.check(), INITIAL_CHECK_DELAY);
    this.timer = setInterval(() => this.check(), UPDATE_CHECK_INTERVAL);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async check() {
    if (this.inProgress) return;
    this.inProgress = true;
    try {
      const infoUrl = this.serverUrl + '/downloads/agent/info';
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch(infoUrl, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!resp.ok) {
        this.log('warn', `[Updater] info fetch failed: HTTP ${resp.status}`);
        return;
      }
      const info = await resp.json();
      this.log('debug', '[Updater] server info', info);

      if (!info.version || !info.downloadUrl) {
        this.log('warn', '[Updater] server returned incomplete info, skipping');
        return;
      }

      if (info.version === CURRENT_VERSION) {
        this.log('debug', '[Updater] already up to date');
        return;
      }

      this.log('info', `[Updater] Update available: v${CURRENT_VERSION} -> v${info.version} (size ${info.size} bytes)`);
      await this.downloadAndApply(info);
    } catch (err) {
      this.log('warn', `[Updater] check failed: ${err.message}`);
    } finally {
      this.inProgress = false;
    }
  }

  async downloadAndApply(info) {
    const exePath = getExePath();
    // Source of truth for the install dir is the running exe's own location,
    // NOT %APPDATA% — the agent runs as NT AUTHORITY\SYSTEM, whose APPDATA is
    // C:\Windows\system32\config\systemprofile\..., not the user's folder.
    const installDir = path.dirname(exePath);
    const psScriptPath = path.join(installDir, 'update-agent.ps1');
    const launcherPath = path.join(installDir, 'run-update.cmd');
    const logPath = path.join(os.tmpdir(), 'printserver-update.log');
    const updaterTask = 'PrintServerAgentUpdater';
    const mainTask = 'PrintServerNodeAgent';

    // 1. Download the PROVEN updater script — the exact same update-agent.ps1
    //    that manage-agent.bat menu [9] runs (stop → download → swap →
    //    restart → verify online). Reusing it means auto-update and manual
    //    update share one battle-tested code path.
    const scriptUrl = this.serverUrl + '/downloads/update-agent.ps1';
    this.log('info', `[Updater] Downloading updater script ${scriptUrl} -> ${psScriptPath}`);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);
    const resp = await fetch(scriptUrl, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`updater script HTTP ${resp.status}`);
    const scriptText = await resp.text();
    if (!scriptText || scriptText.length < 200) throw new Error('updater script too small / empty');
    fs.writeFileSync(psScriptPath, scriptText);

    // 2. Write a launcher .cmd with every arg baked in. This sidesteps the
    //    notorious schtasks /TR quoting problems — the task just points at a
    //    file. The launcher runs the ps1, tees output to a log, then deletes
    //    the one-shot updater task to self-clean.
    const launcher = [
      '@echo off',
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0update-agent.ps1" -ServerUrl "${this.serverUrl}" -TargetDir "${installDir}" -TaskName "${mainTask}" > "${logPath}" 2>&1`,
      `schtasks /Delete /TN "${updaterTask}" /F >nul 2>&1`,
      ''
    ].join('\r\n');
    fs.writeFileSync(launcherPath, launcher);

    // 3. Register the updater as a SEPARATE one-shot scheduled task. THIS IS
    //    THE CRUX OF THE FIX: the agent runs as a SYSTEM scheduled task, so
    //    when it exits, Task Scheduler tears down its ENTIRE process tree —
    //    which previously also killed the child PowerShell bootstrap before it
    //    could swap the exe (symptom: agent STOPPED, version unchanged). A
    //    distinct scheduled task runs in its own independent process tree and
    //    survives the agent's exit.
    const created = await this._run('schtasks', [
      '/Create', '/F', '/TN', updaterTask,
      '/SC', 'ONCE', '/ST', '23:59',
      '/RU', 'SYSTEM', '/RL', 'HIGHEST',
      '/TR', launcherPath
    ]);
    if (!created) {
      throw new Error('failed to create updater scheduled task');
    }

    // 4. Fire it now. Once /Run returns, Task Scheduler owns the updater —
    //    fully decoupled from this process.
    await this._run('schtasks', ['/Run', '/TN', updaterTask]);

    // 5. Exit so the updater can stop/swap us. update-agent.ps1 also force-
    //    stops the agent itself, so this is belt-and-suspenders.
    this.log('info', '[Updater] Updater task launched; exiting in 2s so it can swap to v' + info.version);
    setTimeout(() => {
      this.log('info', '[Updater] Exiting for swap. Updater task will install v' + info.version + ' and restart me.');
      process.exit(0);
    }, 2000);
  }

  // Run a command detached-ish, resolving true on exit code 0. Used for the
  // schtasks calls that register + fire the independent updater task.
  _run(cmd, args) {
    return new Promise((resolve) => {
      try {
        const p = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
        p.on('error', (e) => {
          this.log('warn', `[Updater] ${cmd} ${args[0]} error: ${e.message}`);
          resolve(false);
        });
        p.on('exit', (code) => {
          this.log('info', `[Updater] ${cmd} ${args[0]} exited ${code}`);
          resolve(code === 0);
        });
      } catch (e) {
        this.log('warn', `[Updater] ${cmd} spawn threw: ${e.message}`);
        resolve(false);
      }
    });
  }
}

module.exports = { AutoUpdater, CURRENT_VERSION };
