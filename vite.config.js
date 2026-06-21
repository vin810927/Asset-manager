import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const defaultBase = process.env.CF_PAGES ? "/" : "/Asset-manager/";
const base = process.env.VITE_BASE || defaultBase;

export default defineConfig({
  base,
  plugins: [react()],
});
