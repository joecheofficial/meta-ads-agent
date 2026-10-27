"use strict";

// Zero-network configuration check. This delegates to the module's own
// src/readiness.js so the answer always matches the exact list the module
// enforces at runtime (config/config.json -> requiredEnvVars, which readiness.js
// resolves dynamically through process.env[name]). It reports presence and where
// each value came from (the process environment or the module's local .env file)
// and never reads a credential value. No Graph API request is made.
//
// Worth being precise about: src/api-client.js consumes only META_ADS_ACCESS_TOKEN
// and META_ADS_ACCOUNT_ID. META_ADS_APP_ID and META_ADS_APP_SECRET are required by
// the module's readiness contract (config/config.json) but no code in this release
// reads their values, so they gate the verdict without being consumed. That is
// called out rather than hidden behind a single boolean.
const { readEnvFile, connectionMode } = require("../src/readiness");
const config = require("../config/config.json");

const CONSUMED_BY_API_CLIENT = ["META_ADS_ACCESS_TOKEN", "META_ADS_ACCOUNT_ID"];
const REQUIRED_BUT_NOT_CONSUMED = ["META_ADS_APP_ID", "META_ADS_APP_SECRET"];

module.exports.runRecipe = async function runRecipe() {
  const local = readEnvFile();
  const checks = config.requiredEnvVars.map(name => ({ name, present: Boolean(process.env[name] || local[name]), source: process.env[name] ? "process" : local[name] ? "local-env" : "missing" }));
  const report = { env: checks, missing: checks.filter(entry => !entry.present).map(entry => entry.name), status: "configuration-only", apiVersion: config.apiVersion };
  const configured = report.missing.length === 0;
  const present = report.env.filter((entry) => entry.present).map((entry) => entry.name);

  const lines = [];
  lines.push(
    configured
      ? `Ad account configuration is present. ${present.join(", ")} are all set. Live account access is not verified by this status check.`
      : `Ad account access is not configured yet. Missing: ${report.missing.join(", ")}.${present.length ? ` Already set: ${present.join(", ")}.` : ""} Add the missing names to your own environment or to the module's local .env file, then run this check again.`
  );
  lines.push(`Only ${CONSUMED_BY_API_CLIENT.join(" and ")} are actually used to sign a request. ${REQUIRED_BUT_NOT_CONSUMED.join(" and ")} are required by the readiness contract but are not read by any code in this release.`);
  lines.push(
    configured
      ? "Campaign, ad set, and ad drafts still stay paused by default, and activation or a budget increase still needs your explicit approval."
      : "Offline campaign drafting, paused-by-default launch plans, and this readiness check all work right now without any credentials."
  );

  return {
    status: "ok",
    reply: lines.join(" "),
    artifacts: [],
    metadata: {
      configured,
      missing: report.missing,
      checks: report.env,
      consumedByApiClient: CONSUMED_BY_API_CLIENT,
      requiredButNotRead: REQUIRED_BUT_NOT_CONSUMED,
      readinessStatus: report.status,
      apiVersion: report.apiVersion,
      networkCalls: 0,
    },
  };
};
