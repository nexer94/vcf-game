# vSAN ESA ReadyNode Hardware Guidance – text stránky BCG
Zdroj: https://compatibilityguide.broadcom.com/pages/vsan-esa-readynode-hardware-guidance
Staženo: 2026-11-21T00:29Z (headless prohlížeč, text stránky beze změny)

```text
vSAN ESA ReadyNode Hardware Guidance
Purpose
This document provides sample server configurations as guidelines for deploying vSAN ESA (Express Storage Architecture). Use these recommendations to identify appropriate configurations for your workload requirements.
 
How to use this document
Define workload requirements for your use case.
Filter and search vSAN ESA ReadyNode™ offerings that align with your needs.
Select a vSAN HCI or vSAN Storage Cluster ReadyNode™ using the vSAN ESA BCG from your preferred OEM vendor.

 

Important Notes
ReadyNode profiles ensure balanced CPU, memory, network, and storage utilization.
Deviations from recommended specs are supported but may affect performance and availability.
Example: Using 25 Gb networking instead of the recommended 100 Gb on a vSAN-HCI-LRG profile.
All ReadyNodes must meet or exceed the vSAN-HCI-SM (or vSAN-SC-SM) configuration for VMware Global Services (GS) support.

 

Support Requirements
Servers certified as ReadyNodes for vSAN ESA (HCI or Storage Cluster models).
Certified components: NVMe devices, CPU, NICs.
Hypervisor software settings must align with supported configurations.
To learn how to customize the vSAN ESA Profile, click here
Refer to OEM listings on the Broadcom Compatibility Guide (BCG) for confirmation.

 

vSAN ESA HCI ReadyNode™ Hardware Guidance
 
Description
	vSAN-HCI-SM	vSAN-HCI-MED	vSAN-HCI-LRG

Node Capacity (TB, min) 
	3.2	20	50

CPU (cores/node, min) 
	16	32	48

Memory (GB/node, min)
	128	256	512

Max Storage Devices for base configuration
	12	18	24

Networking (GbE, min)
	10	25	100

Performance for base configuration (IOPS/node, up to)
	50 K	100 K	150 K
 
 
vSAN ESA Storage Cluster ReadyNode™ Hardware Guidance
 
Description
	vSAN-SC-SM	vSAN-SC-MED	vSAN-SC-LRG

CPU (cores/node, min)
	16	32	48

Memory (GB/node, min)
	128	192	256

Nodes per Cluster (min)
	4	6	6

Max Storage Devices for base configuration
	12	18	24

Networking (E/W GbE) (min)
	25	25	100

Networking (N/S GbE) (min)
	10	25	25

Performance for base configuration (IOPS/node, up to)
	50 K	75 K	125 K
 
 
vSAN ESA Cyber Recovery ReadyNode™ Hardware Guidance
 
Description
	CyberRecovery-SM	CyberRecovery-MED	CyberRecovery-LRG

CPU (cores/node, min) 
	16	24	32

Memory (GB/node, min) 
	128	192	256

Nodes per Cluster (min)
	4	6	6

Max Storage Devices for base configuration
	8	18	24

Networking (GbE, min)
	10	25	25

Replication Throughput (node, up to)
	150 MB/s	225 MB/s	300 MB/s
 
Note: Minimum number of devices across profiles must be 4
 
 
Additional Hardware Guidance
Performance Metrics

This guidance offers performance metrics for sizing based on compute-bound mixed workloads using minimum configurations. vSAN can achieve much higher IOPS for storage-bound workloads.

Storage Devices
Type: NVMe TLC
Performance Class: F (100 K–349 K writes/s) or higher
Endurance Class: ≥ 1 DWPD
Capacity: ≥ 1.6 TB
Min Devices per Host Supported: 1
Large Capacity (> 8 TB): Supported on ESXi 8.0 U1+
Read-Intensive Devices: Supported on ESXi 8.0 U1+

 

Storage Devices – NVMe QLC (Cyber Recovery Only)

NVMe QLC devices are supported exclusively for the Cyber Recovery use case. They require 4K IU (Indirection Unit) devices and a minimum of 4 devices per host. QLC support requires ESXi 9.1 or later.

Attribute
	
 Specification


Type
	

NVMe QLC



Performance Class 
	

F (100 K – 349 K writes/s) or higher



Capacity
	
15.36 TB or 30.72 TB


Min Devices per Host Supported
	4 (4K IU devices only)

Minimum ESXi Version
	9.1+

Supported Use Case
	Cyber Recovery only
 

Note: QLC NVMe devices with 4K IU are supported only for Cyber Recovery deployments. This device type is not supported for vSAN HCI or Storage Cluster workloads. Minimum ESXi version required is 9.1+.

 

vSAN Storage Clusters
Min Capacity per Node: 20 TB
Min Devices per Host Supported: 2
vSAN SC Profiles: ESXi 8.0 U2+

 

Sizing and Design Considerations
ESXi Boot
	
Please refer to KB 85685 for boot guidance


Network
	
Dual-port NICs recommended for redundancy.


Device Capacity
	
The capacity point is for reference only. You may select alternative capacity points as long as the Node Capacity and Performance/Endurance requirements are satisfied.


# Storage Tier Devices
	
Increasing the number of devices improves vSAN ESA performance.
 

 

Design Considerations Used for vSAN ESA ReadyNode™ Profiles
Class of SSDs
	The SSD class you select directly influences the overall system performance.

Device Protocol
	The ReadyNode™ is certified for a specific device type (NVMe). Changing the device type is not permitted.
 

 

SSD Performance Classes
SSD PERFORMANCE CLASS
	
WRITES PER SECOND

F	100,000 - 349,999
G	350,000+

 

Other Considerations
 vSAN-HCI-SM or vSAN-SC-SM: ESXi 8.0 P04+ (see KB 372309 and KB 372311)
```
