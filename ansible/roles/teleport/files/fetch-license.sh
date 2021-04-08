#!/usr/bin/bash
export GOOGLE_APPLICATION_CREDENTIALS="/var/lib/teleport/gcs_creds.json"

python3 /tmp/fetch-license.py