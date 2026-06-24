import {
  loadAssets,
  loadExchangeRates,
  loadFinancialGoals,
  saveAssets,
  saveExchangeRates,
  saveFinancialGoals,
} from "../utils.js";

export const LOCAL_DATA_SOURCE_STATUS = {
  mode: "local",
  label: "本機瀏覽器 localStorage",
  description: "資料只存在目前瀏覽器；手機與電腦仍不會自動同步。",
};

export function createLocalStore() {
  return {
    mode: LOCAL_DATA_SOURCE_STATUS.mode,
    status: LOCAL_DATA_SOURCE_STATUS,
    loadAssets,
    saveAssets,
    loadExchangeRates,
    saveExchangeRates,
    loadFinancialGoals,
    saveFinancialGoals,
    async createAsset(asset) {
      return asset;
    },
    async updateAsset(id, asset) {
      return {
        ...asset,
        id,
      };
    },
    async deleteAsset(id) {
      return {
        ok: true,
        deleted: true,
        id,
      };
    },
    loadSnapshot() {
      return {
        assets: loadAssets(),
        exchangeRates: loadExchangeRates(),
        financialGoals: loadFinancialGoals(),
      };
    },
  };
}

export const localStore = createLocalStore();
