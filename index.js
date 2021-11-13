process.env.DEBUG = "HostBase,MyQHost";
process.title = process.env.TITLE || "myq-microservice";

const POLL_TIME = 2 * 1000;

const debug = require("debug")("MyQHost"),
  console = require("console"),
  HostBase = require("microservice-core/HostBase"),
  // myq-api not working due to no more v5 api
  //  MyQ = require("myq-api");
  { myQApi } = require("@koush/myq"),
  MyQ = myQApi;

const TOPIC_ROOT = process.env.TOPIC_ROOT || "myq",
  MQTT_HOST = process.env.MQTT_HOST;

const { MYQ_EMAIL, MYQ_PASSWORD } = process.env;

const logger_debug = () => {
};

const logger = {
  info: () => {
  },

  log: () => {
  },
  debug: () => {
  },
};

class MyQHost extends HostBase {
  constructor(device) {
    super(MQTT_HOST, TOPIC_ROOT + "/" + device.name);
    this.device = device;
    this.serial_number = device.serial_number;
    this.name = device.name;
    this.state = device.state;
    //
    this.physicalDevices = [];
    this.lowBattery = false;

    //
    this.connect();
  }

  //
  // Get updated current device (this.device)
  //
  async getDevice() {
    await this.account.refreshDevices();
    try {
      for (const device of this.account.devices) {
        if (device.serial_number === this.serial_number) {
          this.device = device;
          return;
        }
      }
      console.log(this.name, "getDevice not found", this.serial_number);
    } catch (e) {
      console.log(e);
      console.log(this.account);
      process.exit(1);
    }
  }
  async connect() {
    for (;;) {
      // keep reconnecting on failure
      try {
        const account = new myQApi(
          logger_debug,
          logger,
          MYQ_EMAIL,
          MYQ_PASSWORD,
        );
        this.account = account;
        for (;;) {
          try {
            await this.getDevice();
            const s = {};
            for (const key of Object.keys(this.device.state)) {
              const value = this.device.state[key];
              if (key === 'door_state' || this.device.state[key] != value) {
                s[key] = this.device.state[key];
              }
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
                      s[key] = "opening";
                      continue;
                    }
                  } else if (value === "open") {
                    if (this.state.door_state === "closing") {
                      s[key] = "closing";
                      continue;
                    }
                  }
                  break;
                default:
                  break;
              }
            }
            this.state = s;
          } catch (e) {
            console.log(this.name, "exception", e);
          }
          await this.wait(POLL_TIME);
        }
      } catch (e) {
        await this.wait(POLL_TIME);
        continue;
      }
    }
  }

  async command(topic, message) {
    try {
      switch (topic) {
        case "door":
          if (message.toUpperCase() === "OPEN") {
            await this.account.execute(this.device, "Open");
            this.state = { door_state: "opening" };
          } else if (message.toUpperCase() === "CLOSE") {
            await this.account.execute(this.device, "Close");
            this.state = { door_state: "closing" };
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
    const account = new myQApi(
      logger_debug,
      logger,
      MYQ_EMAIL,
      MYQ_PASSWORD,
    );

    //    const account = new MyQ();
    //    const result = await account.login(
    //      process.env.MYQ_EMAIL,
    //      process.env.MYQ_PASSWORD
    //    );
    //    if (result.code !== "OK") {
    //      continue;
    //    }
    // console.log("result", result);
    await account.refreshDevices();
    // console.log("devices", devices);
    for (const device of account.devices) {
      hosts[device.name] = new MyQHost(device);
    }
    break;
  }
};

main();
