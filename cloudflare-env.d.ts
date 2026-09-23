declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CF_ACCESS_TEAM_URL?: string;
    CF_ACCESS_AUD?: string;
  }
}
