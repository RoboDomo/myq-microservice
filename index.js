process.env.DEBUG = "HostBase,MyQHost";
process.title = process.env.TITLE || "myq-microservice";

const POLL_TIME = 2 * 1000;

const debug = require("debug")("MyQHost"),
  console = require("console"),
  HostBase = require("microservice-core/HostBase"),
  MyQ = require("myq-api");

const TOPIC_ROOT = process.env.TOPIC_ROOT || "myq",
  MQTT_HOST = process.env.MQTT_HOST;

console.log("EMAIL", process.env.MYQ_EMAIL, process.env.MYQ_PASSWORD);
class MyQHost extends HostBase {
  constructor(device) {
    super(MQTT_HOST, TOPIC_ROOT + "/" + device.name);
    this.device = device;
    this.name = device.name;
    this.state = device.state;
    this.serialNumber = device.serial_number;
    //
    this.physicalDevices = [];
    this.lowBattery = false;

    //
    this.connect();
  }

  async connect() {
    for (;;) {
      // keep reconnecting on failure
      try {
        const account = new MyQ();
        this.account = account;
        const result = await account.login(
          process.env.MYQ_EMAIL,
          process.env.MYQ_PASSWORD
        );
        if (result.code !== "OK") {
          // login failed
          console.log(this.name, "login failed", result);
          continue;
        }
        for (;;) {
          try {
            const result = await account.getDevice(this.serialNumber);
            for (const key of Object.keys(result.device.state)) {
              const value = result.device.state[key];
              const s = {};
              s[key] = result.device.state[key];
              switch (key) {
                case "physical_devices":
                  if (this.physicalDevices.length !== value.length) {
                    this.physicalDevices = value;
                  } else {
                    continue;
                  }
                  break;
                case "dps_low_battery_mode":
                  if (value && !this.lowBattery) {
                    this.lowBattery = value;
                    this.alert("DANGER", `${this.name} battery is low!`);
                  }
                  break;
                case "door_state":
                  if (value === "closed") {
                    if (this.state.door_state === "opening") {
                      continue;
                    }
                  } else if (value === "open") {
                    if (this.state.door_state === "closing") {
                      continue;
                    }
                  }
                  break;
                default:
                  break;
              }
              this.state = s;
            }
          } catch (e) {
            console.log(this.name, "exception", e);
          }
          await this.wait(POLL_TIME);
        }
      } catch (e) {
        this.wait(POLL_TIME);
        continue;
      }
    }
  }

  async command(topic, message) {
    try {
      switch (topic) {
        case "door":
          if (message.toUpperCase() === "OPEN") {
            const result = await this.account.setDoorState(
              this.serialNumber,
              MyQ.actions.door.OPEN
            );
            if (result.code !== "OK") {
              console.log(this.name, "OPEN FAIL result ", result);
            } else {
              this.state = { door_state: "opening" };
            }
          } else if (message.toUpperCase() === "CLOSE") {
            const result = await this.account.setDoorState(
              this.serialNumber,
              MyQ.actions.door.CLOSE
            );
            if (result.code !== "OK") {
              console.log(this.name, "CLOSE FAIL result ", result);
            } else {
              this.state = { door_state: "closing" };
            }
          }
          break;
        default:
          console.log(this.name, "INVALID myQ command", topic, message);
          break;
      }
    } catch (e) {
      console.log(this.name, "MyQ command exception", e);
    }
  }
}

const main = async () => {
  const hosts = {};
  for (;;) {
    const account = new MyQ();
    const result = await account.login(
      process.env.MYQ_EMAIL,
      process.env.MYQ_PASSWORD
    );
    if (result.code !== "OK") {
      continue;
    }
    // console.log("result", result);
    const devices = await account.getDevices();
    if (devices.code !== "OK") {
      continue;
    }
    // console.log("devices", devices);
    for (const device of devices.devices) {
      hosts[device.name] = new MyQHost(device);
    }
    break;
  }
};

main();
