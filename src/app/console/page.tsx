import { LiveConsole } from "../components/LiveConsole";

// Standalone live console. The component is theme-aware (follows the site's
// light/dark toggle) and read-only — it never triggers a scan.
export default function ConsolePage() {
  return <LiveConsole />;
}
