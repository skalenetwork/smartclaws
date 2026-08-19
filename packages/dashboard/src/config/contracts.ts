import PublicKeyRegistryABI from "@smartclaws/core/abi/PublicKeyRegistry.json";

import SmartClawsABI from "@smartclaws/core/abi/SmartClaws.json";
import SmartClawsAgentABI from "@smartclaws/core/abi/SmartClawsAgent.json";
import SmartClawsChannelABI from "@smartclaws/core/abi/SmartClawsChannel.json";
import SmartClawsChannelEncryptedABI from "@smartclaws/core/abi/SmartClawsChannelEncrypted.json";
import SmartClawsDeviceABI from "@smartclaws/core/abi/SmartClawsDevice.json";
import SmartClawsDeviceGroupABI from "@smartclaws/core/abi/SmartClawsDeviceGroup.json";
import type { Abi } from "viem";

export const abis = {
    registry: SmartClawsABI.abi as Abi,
    agent: SmartClawsAgentABI.abi as Abi,
    channel: SmartClawsChannelABI.abi as Abi,
    channelEncrypted: SmartClawsChannelEncryptedABI.abi as Abi,
    device: SmartClawsDeviceABI.abi as Abi,
    deviceGroup: SmartClawsDeviceGroupABI.abi as Abi,
    publicKeyRegistry: PublicKeyRegistryABI.abi as Abi,
};
