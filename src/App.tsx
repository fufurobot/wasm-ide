import { IDE } from "@/components/IDE";
import "./index.css";

/**
 * The whole application is the IDE. The previous Bun+React starter screen and
 * its `/api/hello` tester are gone on purpose: this app must be servable from
 * a plain static host, so it may not depend on any server-side route.
 */
export function App() {
  return <IDE />;
}

export default App;
