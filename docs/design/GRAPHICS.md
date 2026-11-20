# Grafický design – VCF Game

## Styl
- **2,5D izometrie** (úhel ~30°), čistý „low-poly / flat“ styl – inspirace hravostí minimapa.cz,
  ale žádné 3D, žádný realistický terén.
- Tmavé, klidné pozadí (podlaha datacentra / mapa), objekty světlé, výrazné jen to, co je důležité.
- Žádná loga ani přesné kopie UI Broadcomu – vlastní ikony a barvy.

## Úrovně zoomu
| Úroveň | Co je vidět |
|---|---|
| Private Cloud | ostrovy = fleety, mezi nimi linky |
| Fleet | fleet management komponenty (VCF Operations, VCF Automation, …) + instance jako „budovy“ |
| Instance | management doména + workload domény jako oddělené „čtvrti“ |
| Domain / Cluster | racky v řadách, NSX segmenty jako barevné zóny na podlaze |
| Rack / Host | jednotlivé servery, NIC, uplinky, VM jako malé kostičky |

Přechody mezi úrovněmi plynulým zoomem (jako přelet nad mapou).

## Vizualizace provozu
- Pakety = malé svítící tečky jedoucí po kabelech (bezier křivky), hustota = objem provozu.
- Barvy typů provozu:
  | Typ | Barva |
  |---|---|
  | Management | šedomodrá `#8aa4c8` |
  | vMotion | oranžová `#f0a14a` |
  | vSAN | zelená `#4cc38a` |
  | NFS / storage | tyrkysová `#3fb8c9` |
  | NSX overlay | fialová `#a37cf0` |
  | VM / north-south | bílá `#e8edf3` |
- Tloušťka linky = vytížení, nad 80 % žlutá, nad 95 % červená; zahozené pakety „odpadnou“ a zmizí.
- Vždy viditelná legenda, ovládání času (pauza / 1× / 4× / 16×), hover = detail linky
  (throughput, latence, fronta, dropy).
- Hodnoty, které nejsou přímo z dokumentace, UI označí jako „ilustrativní model“.

## Technika
- PixiJS (WebGL), sprity generované z vektorů, batching, cíl 60 FPS i na Chromebooku.
- Herní logika oddělená od kreslení (engine → snapshot → render).
