import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { readFileSync } from 'fs';
import * as _ from "lodash";

const project_name = gcp.config.project;
const region = gcp.config.region;
const machine_type_name = "n1-standard-2";
const image_name = "ubuntu-os-cloud/ubuntu-2004-lts";
const pip_version = "19.3.1";
const dependencies = JSON.stringify({"ansible": "2.9.2", "six": "1.13.0", "decorator": "4.4.1"});
const project_config = new pulumi.Config();
const gcp_config = new pulumi.Config("teleport-gcp");
console.log(`Version: ${project_config.require("infra_version")}`);
const infra_version = project_config.require("infra_version");

export = async () => {

    // ** NOTE ** Run pulumi up in pulumi-gcp-ips first
    const external_ip = await gcp.compute.getAddress({
        name: "proxy-ip-address"
    });

    // ** NOTE ** secrets manually created and added to GCP secrets store before executing this
    const github_api_token = await gcp.secretmanager.getSecretVersion({
        secret: "teleport-on-gcp-github-access-token"
    });

    const priv_key_pem = await gcp.secretmanager.getSecretVersion({
        secret: "teleport-on-gcp-<your domain>-key"
    });

    const priv_key_fullchain = await gcp.secretmanager.getSecretVersion({
        secret: "teleport-on-gcp-<your domain>-fullchain"
    });

    const vpc_network = new gcp.compute.Network("teleport-network", {
        project: project_name,
        autoCreateSubnetworks: true
    });

    const subnet = new gcp.compute.Subnetwork("teleport-subnet", {
        network: vpc_network.id,
        ipCidrRange: "10.10.0.0/16",
        region: "europe-west2",
    });

    const router = new gcp.compute.Router("teleport-router", {
        region: subnet.region,
        network: vpc_network.id,
        bgp: {
            asn: 64514,
        },
    });
    const nat = new gcp.compute.RouterNat("teleport-nat", {
        router: router.name,
        region: router.region,
        natIpAllocateOption: "AUTO_ONLY",
        sourceSubnetworkIpRangesToNat: "ALL_SUBNETWORKS_ALL_IP_RANGES",
        logConfig: {
            enable: true,
            filter: "ERRORS_ONLY",
        },
    });

    const firewall = new gcp.compute.Firewall("teleport-firewall", {
        network: vpc_network.name,
        allows: [
            {
                protocol: "icmp",
            },
            {
                protocol: "tcp",
                ports: [
                    "22",
                    "3000",
                    "3080",
                    "3022-3026"
                ],
            },
        ],
        targetTags: ["teleport"]
    });

    const key_json = readFileSync('/tmp/test.json');
    let private_key_encoded = Buffer.from(key_json).toString();
    let fullchain_encoded = Buffer.from(priv_key_fullchain.secretData).toString('base64');
    let key_encoded = Buffer.from(priv_key_pem.secretData).toString('base64');

    const user_data_template = readFileSync('./cloud-config').toString();
    const vars_map = {
        private_key_json: private_key_encoded,
        github_api_token: github_api_token.secretData,
        fullchain: fullchain_encoded,
        pem: key_encoded
    }
    const compiled_user_data = _.template(user_data_template);
    const rendered_user_data = compiled_user_data(vars_map);

    let auth_instance = new gcp.compute.Instance("teleport-auth", {
        project: project_name,
        machineType: machine_type_name,
        zone: "europe-west2-a",
        tags: ["auth", "teleport"],
        bootDisk: {
            initializeParams: {
                image: image_name,
            },
        },
        networkInterfaces: [
            {
                subnetwork: subnet.selfLink
            },
        ],
        metadata: {
            environment: "teleport-gcp",
            component: "teleport-auth-server",
            class: "teleport-auth-server",
            playbook: "teleport-auth-server.yaml",
            pip: pip_version,
            dependencies: dependencies,
            env_vars_file: "teleport-gcp.yml",
            playbook_dir: "",
            infra_version: infra_version,
            "user-data": rendered_user_data
        },
    });

    const region_auth_server_health_check = new gcp.compute.RegionHealthCheck("auth-server-health-check", {
        region: "europe-west2",
        timeoutSec: 1,
        checkIntervalSec: 1,
        tcpHealthCheck: {
            port: 3000,
        },
    });

    const auth_instance_group = new gcp.compute.InstanceGroup("auth-instance-group", {
        description: "auth-instance-group",
        zone: "europe-west2-a",
        instances: [auth_instance.selfLink],
        namedPorts: [
            {
                name: "teleport-web",
                port: 3080,
            },
            {
                name: "teleport-diag",
                port: 3000,
            },
            {
                name: "teleport-auth",
                port: 3025,
            },
            {
                name: "teleport-listen",
                port: 3023,
            },
            {
                name: "teleport-tunnel-listen",
                port: 3024,
            },
            {
                name: "teleport-ssh",
                port: 3022,
            },
        ],
    });

    const region_auth_backend = new gcp.compute.RegionBackendService("auth-backend", {
        portName: "teleport-web",
        protocol: "TCP",
        loadBalancingScheme: "EXTERNAL",
        backends: [
            {
                group: auth_instance_group.selfLink,
            }
        ],
        healthChecks: region_auth_server_health_check.selfLink
    });
    
    const default_forwarding_rule = new gcp.compute.ForwardingRule("default-forwarding-rule", {
        region: "europe-west2",
        project: project_name,
        loadBalancingScheme: "EXTERNAL",
        ipAddress: external_ip.address,
        portRange: "3000-3080",
        backendService: region_auth_backend.id
    });
}