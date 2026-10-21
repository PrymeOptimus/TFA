import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

const handler = (req: Request) => getAuth().handler(req);
export const { GET, POST } = toNextJsHandler(handler);
