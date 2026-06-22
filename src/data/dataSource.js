import { cloudStore as defaultCloudStore } from "./cloudStore.js";
import { localStore as defaultLocalStore } from "./localStore.js";

export const DATA_SOURCE_MODES = {
  LOCAL: "local",
  CLOUD: "cloud",
};

export const CLOUD_SYNC_STATUS = {
  mode: DATA_SOURCE_MODES.CLOUD,
  label: "Cloudflare D1 雲端同步",
  description: "準備中；v0.7 尚未啟用跨裝置同步。",
};

export function getDefaultDataSourceMode() {
  return DATA_SOURCE_MODES.LOCAL;
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
    status: activeStore.status,
    cloudStatus: CLOUD_SYNC_STATUS,
    loadAssets() {
      return localStore.loadAssets();
    },
    saveAssets(assets) {
      return localStore.saveAssets(assets);
    },
    loadExchangeRates() {
      return localStore.loadExchangeRates();
    },
    saveExchangeRates(exchangeRates) {
      return localStore.saveExchangeRates(exchangeRates);
    },
    loadFinancialGoals() {
      return localStore.loadFinancialGoals();
    },
    saveFinancialGoals(financialGoals) {
      return localStore.saveFinancialGoals(financialGoals);
    },
    loadSnapshot() {
      return localStore.loadSnapshot();
    },
  };
}

export const defaultDataSource = createDataSource();
