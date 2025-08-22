#!/usr/bin/env bash
set -euo pipefail

# run stations job
krawler ./jobfile.stations.js
# run metars job
export DATA=metars
krawler ./jobfile.metars-tafs.js
# run tafs job
export DATA=tafs
krawler ./jobfile.metars-tafs.js