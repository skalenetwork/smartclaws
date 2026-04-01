import { keepPreviousData } from "@tanstack/react-query";
import { decode } from "@smartclaws/core/envelope";
import { useMemo } from "react";
import { type Address, type Hex, hexToBytes } from "viem";
import { useReadContracts } from "wagmi";
import { abis } from "@/config/contracts";
import { chain } from "@/config/wagmi";

export interface DeviceInfo {
  address: Address;
  registered: boolean;
  publisher: Address;
  incomingChannel: Address;
  outgoingChannel: Address;
  lastMessageTs?: number;
  devName?: string;
}

export function useGroupDetail(groupAddress: Address) {
  const contract = { address: groupAddress, abi: abis.deviceGroup, chainId: chain.id } as const;

  const { data: meta, isLoading: isLoadingMeta } = useReadContracts({
    contracts: [
      { ...contract, functionName: "groupName" },
      { ...contract, functionName: "skills" },
      { ...contract, functionName: "active" },
      { ...contract, functionName: "owner" },
      { ...contract, functionName: "getDevices" },
    ],
    query: { refetchInterval: 15_000, placeholderData: keepPreviousData },
  });

  const groupName = meta?.[0]?.result as string | undefined;
  const skills = meta?.[1]?.result as string | undefined;
  const active = meta?.[2]?.result as boolean | undefined;
  const owner = meta?.[3]?.result as Address | undefined;
  const deviceAddresses = (meta?.[4]?.result as Address[] | undefined) ?? [];

  const { data: deviceDetails, isLoading: isLoadingDevices } = useReadContracts({
    contracts: deviceAddresses.map((addr) => ({
      address: groupAddress,
      abi: abis.deviceGroup,
      functionName: "getDeviceInfo",
      args: [addr],
      chainId: chain.id,
    })),
    query: {
      enabled: deviceAddresses.length > 0,
      refetchInterval: 15_000,
      placeholderData: keepPreviousData,
    },
  });

  const outgoingChannels = useMemo(() => {
    return deviceAddresses.map((_addr, i) => {
      const info = deviceDetails?.[i]?.result as
        | { outgoingChannel: Address }
        | undefined;
      return info?.outgoingChannel;
    });
  }, [deviceAddresses, deviceDetails]);

  // Get latest message offset for each outgoing channel
  const { data: latestOffsets } = useReadContracts({
    contracts: outgoingChannels.map((ch) => ({
      address: ch ?? ("0x" as Address),
      abi: abis.channel,
      functionName: "getLatestMessageOffset",
      chainId: chain.id,
    })),
    query: {
      enabled: outgoingChannels.some((ch) => !!ch),
      refetchInterval: 15_000,
      placeholderData: keepPreviousData,
    },
  });

  // Read the latest message from each channel
  const { data: latestMessages } = useReadContracts({
    contracts: outgoingChannels.map((ch, i) => {
      const offset = latestOffsets?.[i]?.result as bigint | undefined;
      return {
        address: ch ?? ("0x" as Address),
        abi: abis.channel,
        functionName: "readMessages",
        args: [offset ?? 0n, 1n],
        chainId: chain.id,
      };
    }),
    query: {
      enabled: latestOffsets?.some((r) => r?.result !== undefined) ?? false,
      refetchInterval: 15_000,
      placeholderData: keepPreviousData,
    },
  });

  const devices: DeviceInfo[] = deviceAddresses.map((addr, i) => {
    const info = deviceDetails?.[i]?.result as
      | {
          registered: boolean;
          publisher: Address;
          incomingChannel: Address;
          outgoingChannel: Address;
        }
      | undefined;

    let lastMessageTs: number | undefined;
    let devName: string | undefined;
    try {
      const raw = latestMessages?.[i]?.result as [Hex[], bigint[]] | undefined;
      if (raw?.[0]?.[0]) {
        const envelope = decode(hexToBytes(raw[0][0]));
        lastMessageTs = envelope.ts;
        devName = envelope.dev;
      }
    } catch {
      // ignore decode errors
    }

    return {
      address: addr,
      registered: info?.registered ?? false,
      publisher: info?.publisher ?? ("0x" as Address),
      incomingChannel: info?.incomingChannel ?? ("0x" as Address),
      outgoingChannel: info?.outgoingChannel ?? ("0x" as Address),
      lastMessageTs,
      devName,
    };
  });

  return {
    groupName,
    skills,
    active,
    owner,
    devices,
    isLoading: isLoadingMeta || isLoadingDevices,
  };
}
