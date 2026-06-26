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
      return activeStore.createAsset(asset);
    },
    updateAsset(id, asset) {
      return activeStore.updateAsset(id, asset);
    },
    deleteAsset(id) {
      return activeStore.deleteAsset(id);
    },
    loadExchangeRates() {
      return activeStore.loadExchangeRates ? activeStore.loadExchangeRates() : activeStore.getExchangeRates();
    },
    saveExchangeRates(exchangeRates) {
      return activeStore.saveExchangeRates
        ? activeStore.saveExchangeRates(exchangeRates)
        : activeStore.updateExchangeRates(exchangeRates);
    },
    loadFinancialGoals() {
      return activeStore.loadFinancialGoals ? activeStore.loadFinancialGoals() : activeStore.getFinancialGoals();
    },
    saveFinancialGoals(financialGoals) {
      return activeStore.saveFinancialGoals
        ? activeStore.saveFinancialGoals(financialGoals)
        : activeStore.updateFinancialGoals(financialGoals);
    },
    loadSnapshot() {
      return activeStore.loadSnapshot();
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
      const result = await cloudStore.restoreSnapshot(snapshotId, options);
      const snapshot = await cloudStore.loadSnapshot();

      return {
        result,
        snapshot,
      };
    },
  };
}

export const defaultDataSource = createDataSource();
