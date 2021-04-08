import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as fs from 'fs';

const project_name = "<your gcp project>";

const service_account = new gcp.serviceaccount.Account("teleport-service-account", {
    accountId: "teleport-service-account",
    displayName: "Teleport Service Account",
});

new gcp.projects.IAMMember("datastore-owner", {
    project: project_name,
    role: "roles/datastore.owner",
    member: pulumi.interpolate`serviceAccount:${service_account.email}`
});

new gcp.projects.IAMMember("storage-object-admin", {
    project: project_name,
    role: "roles/storage.admin",
    member: pulumi.interpolate`serviceAccount:${service_account.email}`
});

new gcp.projects.IAMMember("instance-metadata-viewer", {
    project: project_name,
    role: "roles/compute.osAdminLogin",
    member: pulumi.interpolate`serviceAccount:${service_account.email}`
});

const service_account_key = new gcp.serviceaccount.Key("teleport-service-account-key", {
    serviceAccountId: service_account.name,
    publicKeyType: "TYPE_X509_PEM_FILE",
});

service_account_key.privateKey.apply(k => fs.writeFileSync("/tmp/test.json", k.toString()));