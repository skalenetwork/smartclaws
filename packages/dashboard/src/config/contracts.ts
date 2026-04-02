import type { Abi } from "viem";

import SmartClawsABI from "@smartclaws/core/abi/SmartClaws.json";
import SmartClawsAgentABI from "@smartclaws/core/abi/SmartClawsAgent.json";
import SmartClawsChannelABI from "@smartclaws/core/abi/SmartClawsChannel.json";
import SmartClawsDeviceABI from "@smartclaws/core/abi/SmartClawsDevice.json";
import SmartClawsDeviceGroupABI from "@smartclaws/core/abi/SmartClawsDeviceGroup.json";

export const abis = {
  registry: SmartClawsABI.abi as Abi,
  agent: SmartClawsAgentABI.abi as Abi,
  channel: SmartClawsChannelABI.abi as Abi,
  device: SmartClawsDeviceABI.abi as Abi,
  deviceGroup: SmartClawsDeviceGroupABI.abi as Abi,
};
