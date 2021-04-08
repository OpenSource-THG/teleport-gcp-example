import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

// Create a GCP bucket for session recordings
const bucket = new gcp.storage.Bucket("teleport-session-recordings", {
    location: "EU",
    uniformBucketLevelAccess: true
});

const app = new gcp.appengine.Application("teleport-storage", {
    project: "<your gcp project id>",
    locationId: "europe-west2", 
    databaseType: "CLOUD_FIRESTORE"
})