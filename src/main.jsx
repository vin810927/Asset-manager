import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell">
          <section className="panel">
            <h1>Asset Agent 載入失敗</h1>
            <p className="muted">{this.state.error.message}</p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function showBootError(error) {
  const root = document.getElementById("root");
  if (!root) return;

  root.innerHTML = `
    <main class="app-shell">
      <section class="panel">
        <h1>Asset Agent 載入失敗</h1>
        <p class="muted">${error.message}</p>
      </section>
    </main>
  `;
}

window.addEventListener("error", (event) => showBootError(event.error ?? event));
window.addEventListener("unhandledrejection", (event) => showBootError(event.reason ?? event));

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
