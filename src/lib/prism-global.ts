import Prism from "prismjs";

// Prism's language components register on a global `Prism`; set it before they load.
(globalThis as { Prism?: typeof Prism }).Prism = Prism;
Prism.manual = true;

export default Prism;
