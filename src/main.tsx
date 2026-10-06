/**
 * Application entry point.
 *
 * React StrictMode is deliberately omitted: the session hooks own child
 * processes, and StrictMode's double-invoked effects would spawn a second
 * shell and a second Claude process on every mount.
 */
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/github-dark.css";
import "./styles.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("the #root element is missing from index.html");

createRoot(container).render(<App />);
