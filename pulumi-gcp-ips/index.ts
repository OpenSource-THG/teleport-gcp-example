import * as gcp from "@pulumi/gcp";

const ipAddress = new gcp.compute.Address("proxy-ip-address", {
    region: "europe-west2",
    name: "proxy-ip-address"
});
