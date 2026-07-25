import { cloudStore as defaultCloudStore } from "./cloudStore.js";
import { localStore as defaultLocalStore } from "./localStore.js";

export const DATA_SOURCE_MODES = {
  LOCAL: "local",
  CLOUD: "cloud",
};
export const DATA_SOURCE_MODE_STORAGE_KEY = "assetAgent.dataSourceMode";

export const CLOUD_SYNC_STATUS = {
  mode: DATA_SOURCE_MODES.CLOUD,
  label: "Cloudflare D1 雲端同步",
  description: "opt-in；啟用後以 D1 作為主資料源，但不做自動雙向同步。",
};
export const STALE_CLOUD_DATA_ERROR_CODE = "STALE_CLOUD_DATA";
export const STALE_CLOUD_DATA_MESSAGE = "雲端資料已在其他裝置或頁面更新。為避免覆蓋新資料，請重新整理後再修改。";

function getLocalStorage() {
  return globalThis.window?.localStorage ?? globalThis.localStorage;
}

function normalizeDataSourceMode(mode) {
  return mode === DATA_SOURCE_MODES.CLOUD ? DATA_SOURCE_MODES.CLOUD : DATA_SOURCE_MODES.LOCAL;
}

function normalizeAssetsForDataSource(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.assets)) return value.assets;
  return [];
}

function resolveAssetsForDataSource(value) {
  return typeof value?.then === "function" ? value.then(normalizeAssetsForDataSource) : normalizeAssetsForDataSource(value);
}

function createLocalOnlySnapshotError() {
  return new Error("D1 snapshot 只在 Cloud Mode 下可用。");
}

function createStaleCloudDataError() {
  const error = new Error(STALE_CLOUD_DATA_MESSAGE);
  error.code = STALE_CLOUD_DATA_ERROR_CODE;
  return error;
}

function getRevisionTimestamp(revision) {
  if (!revision?.cloudUpdatedAt) return 0;

  const timestamp = Date.parse(revision.cloudUpdatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isCloudRevisionNewer(currentRevision, baselineRevision) {
  return getRevisionTimestamp(currentRevision) > getRevisionTimestamp(baselineRevision);
}

export function getStoredDataSourceMode() {
  try {
    const storage = getLocalStorage();
    return normalizeDataSourceMode(storage?.getItem(DATA_SOURCE_MODE_STORAGE_KEY));
  } catch {
    return DATA_SOURCE_MODES.LOCAL;
  }
}

export function setStoredDataSourceMode(mode) {
  const nextMode = normalizeDataSourceMode(mode);

  try {
    const storage = getLocalStorage();
    storage?.setItem(DATA_SOURCE_MODE_STORAGE_KEY, nextMode);
  } catch {
    // Ignore unavailable storage; the current in-memory state still drives this session.
  }

  return nextMode;
}

export function getDefaultDataSourceMode() {
  return getStoredDataSourceMode();
}

export function createDataSource({
  mode = getDefaultDataSourceMode(),
  localStore = defaultLocalStore,
  cloudStore = defaultCloudStore,
} = {}) {
  const activeStore = mode === DATA_SOURCE_MODES.CLOUD ? cloudStore : localStore;
  const activeMode = mode === DATA_SOURCE_MODES.CLOUD ? DATA_SOURCE_MODES.CLOUD : DATA_SOURCE_MODES.LOCAL;
  let cloudRevisionBaseline = null;

  async function refreshCloudRevisionBaseline() {
    if (activeMode !== DATA_SOURCE_MODES.CLOUD || typeof cloudStore.getCloudRevision !== "function") return null;

    cloudRevisionBaseline = await cloudStore.getCloudRevision();
    return cloudRevisionBaseline;
  }

  async function syncCloudRevisionBaselineAfterWrite() {
    try {
      return await refreshCloudRevisionBaseline();
    } catch {
      cloudRevisionBaseline = null;
      return null;
    }
  }

  async function assertCloudRevisionFresh() {
    if (activeMode !== DATA_SOURCE_MODES.CLOUD) return null;
    if (typeof cloudStore.getCloudRevision !== "function") {
      throw new Error("Cloud revision API is not configured.");
    }

    const currentRevision = await cloudStore.getCloudRevision();

    if (cloudRevisionBaseline && isCloudRevisionNewer(currentRevision, cloudRevisionBaseline)) {
      throw createStaleCloudDataError();
    }

    cloudRevisionBaseline = currentRevision;
    return currentRevision;
  }

  async function runGuardedCloudWrite(writeOperation) {
    await assertCloudRevisionFresh();
    const result = await writeOperation();
    await syncCloudRevisionBaselineAfterWrite();
    return result;
  }

  return {
    mode: activeMode,
    activeStore,
    cloudStore,
    status: activeStore.status,
    cloudStatus: CLOUD_SYNC_STATUS,
    loadAssets() {
      return resolveAssetsForDataSource(activeStore.loadAssets ? activeStore.loadAssets() : activeStore.getAssets());
    },
    saveAssets(assets) {
      if (activeMode === DATA_SOURCE_MODES.CLOUD) {
        throw new Error("Cloud mode does not support bulk asset save.");
      }

      return localStore.saveAssets(assets);
    },
    createAsset(asset) {
      if (activeMode === DATA_SOURCE_MODES.CLOUD) {
        return runGuardedCloudWrite(() => cloudStore.createAsset(asset));
      }

      return activeStore.createAsset(asset);
    },
    updateAsset(id, asset) {
      if (activeMode === DATA_SOURCE_MODES.CLOUD) {
        return runGuardedCloudWrite(() => cloudStore.updateAsset(id, asset));
      }

      return activeStore.updateAsset(id, asset);
    },
    deleteAsset(id) {
      if (activeMode === DATA_SOURCE_MODES.CLOUD) {
        return runGuardedCloudWrite(() => cloudStore.deleteAsset(id));
      }

      return activeStore.deleteAsset(id);
    },
    loadExchangeRates() {
      return activeStore.loadExchangeRates ? activeStore.loadExchangeRates() : activeStore.getExchangeRates();
    },
    saveExchangeRates(exchangeRates) {
      if (activeMode === DATA_SOURCE_MODES.CLOUD) {
        return runGuardedCloudWrite(() =>
          cloudStore.saveExchangeRates
            ? cloudStore.saveExchangeRates(exchangeRates)
            : cloudStore.updateExchangeRates(exchangeRates),
        );
      }

      return activeStore.saveExchangeRates
        ? activeStore.saveExchangeRates(exchangeRates)
        : activeStore.updateExchangeRates(exchangeRates);
    },
    loadFinancialGoals() {
      return activeStore.loadFinancialGoals ? activeStore.loadFinancialGoals() : activeStore.getFinancialGoals();
    },
    saveFinancialGoals(financialGoals) {
      if (activeMode === DATA_SOURCE_MODES.CLOUD) {
        return runGuardedCloudWrite(() =>
          cloudStore.saveFinancialGoals
            ? cloudStore.saveFinancialGoals(financialGoals)
            : cloudStore.updateFinancialGoals(financialGoals),
        );
      }

      return activeStore.saveFinancialGoals
        ? activeStore.saveFinancialGoals(financialGoals)
        : activeStore.updateFinancialGoals(financialGoals);
    },
    previewMarketExchangeRates(payload) {
      if (typeof cloudStore.previewMarketExchangeRates !== "function") {
        return Promise.reject(new Error("Market data preview API is not configured."));
      }

      return cloudStore.previewMarketExchangeRates(payload);
    },
    previewMarketStockPrices(payload) {
      if (typeof cloudStore.previewMarketStockPrices !== "function") {
        return Promise.reject(new Error("Market data preview API is not configured."));
      }

      return cloudStore.previewMarketStockPrices(payload);
    },
    loadSnapshot() {
      const snapshotValue = activeStore.loadSnapshot();

      if (activeMode !== DATA_SOURCE_MODES.CLOUD) {
        return snapshotValue;
      }

      return Promise.resolve(snapshotValue).then(async (snapshot) => {
        const revision =
          snapshot?.revision && typeof snapshot.revision === "object"
            ? snapshot.revision
            : await refreshCloudRevisionBaseline();
        cloudRevisionBaseline = revision;

        return {
          ...snapshot,
          assets: normalizeAssetsForDataSource(snapshot?.assets),
          revision,
        };
      });
    },
    getCloudRevisionBaseline() {
      return cloudRevisionBaseline;
    },
    refreshCloudRevisionBaseline,
    importLocalBackup(backupPayload) {
      if (activeMode !== DATA_SOURCE_MODES.CLOUD) return cloudStore.importLocalBackup(backupPayload);
      return runGuardedCloudWrite(() => cloudStore.importLocalBackup(backupPayload));
    },
    listSnapshots() {
      if (activeMode !== DATA_SOURCE_MODES.CLOUD) return Promise.reject(createLocalOnlySnapshotError());
      return cloudStore.listSnapshots();
    },
    createSnapshot(options) {
      if (activeMode !== DATA_SOURCE_MODES.CLOUD) return Promise.reject(createLocalOnlySnapshotError());
      return cloudStore.createSnapshot(options);
    },
    getSnapshot(snapshotId) {
      if (activeMode !== DATA_SOURCE_MODES.CLOUD) return Promise.reject(createLocalOnlySnapshotError());
      return cloudStore.getSnapshot(snapshotId);
    },
    getRestorePreview(snapshotId) {
      if (activeMode !== DATA_SOURCE_MODES.CLOUD) return Promise.reject(createLocalOnlySnapshotError());
      return cloudStore.getRestorePreview(snapshotId);
    },
    async restoreSnapshot(snapshotId, options) {
      if (activeMode !== DATA_SOURCE_MODES.CLOUD) return Promise.reject(createLocalOnlySnapshotError());
      const result = await runGuardedCloudWrite(() => cloudStore.restoreSnapshot(snapshotId, options));
      const snapshot = await cloudStore.loadSnapshot();
      cloudRevisionBaseline = snapshot?.revision ?? (await refreshCloudRevisionBaseline());

      return {
        result,
        snapshot,
      };
    },
  };
}

export const defaultDataSource = createDataSource();
