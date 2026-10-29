/**
 * Keep Next instrumentation side-effect free. The cPanel Node entrypoint
 * (server.js) runs the PostgreSQL startup diagnostic before it starts listening;
 * importing the Node-only `pg` driver here would also bundle it for Edge.
 */
export function register() {}
