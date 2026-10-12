import { createApi } from "../_lib/api.js";

const handle = createApi();

export function onRequest(context) {
  return handle(context);
}
