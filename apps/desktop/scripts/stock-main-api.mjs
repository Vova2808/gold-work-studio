// Test-only access to the actual registered production handlers. Install before
// loading main. No renderer retry: an unreturned paid call must not be resubmitted.
const channels = {
  getAppInfo: 'app:info', getProject: 'projects:get', getQueue: 'queue:list',
  startGeneration: 'queue:start', stopGeneration: 'queue:stop',
  getAnyModelSettings: 'anymodel:get-settings', listChannelProfiles: 'channels:list',
  listVoicerTemplates: 'voicer:templates', calibrateVoice: 'voice:calibrate',
  createProject: 'projects:create', updateProject: 'projects:update',
  prepareProjectScript: 'projects:prepare-script',
  autoSelectStock: 'stock:auto-select',
};

export function installStockMainApi(ipcMain) {
  const handlers = new Map();
  const originalHandle = ipcMain.handle;
  ipcMain.handle = function(channel, handler) {
    originalHandle.call(this, channel, handler);
    handlers.set(channel, handler);
  };
  let sender, progress;
  return {
    attach(webContents) {
      if (sender) throw new Error('Harness already attached');
      sender = webContents;
      const originalSend = sender.send;
      sender.send = function(channel, ...args) {
        if (channel === 'stock:auto-progress') progress = structuredClone(args[0]);
        return originalSend.call(this, channel, ...args);
      };
    },
    progress: () => progress,
    async call(method, ...args) {
      const handler = handlers.get(channels[method]);
      if (!handler || !sender) throw new Error(`Production API unavailable: ${method}`);
      // Match IPC value isolation; retain the real sender for normal app events.
      return structuredClone(await handler({ sender }, ...structuredClone(args)));
    },
  };
}
