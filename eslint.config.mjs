import next from "eslint-config-next";

const config = [
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "test-results/**", "playwright-report/**", ".tmp/**", "next-env.d.ts"] },
  ...next,
];
export default config;
