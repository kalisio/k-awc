#!/usr/bin/env bash
set -euo pipefail

krawler ./jobfile.stations.js
export DATA=metars
krawler ./jobfile.metars-tafs.js
export DATA=tafs
krawler ./jobfile.metars-tafs.js