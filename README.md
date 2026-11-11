# LAPV – interaktivní geoportál

Statická webová aplikace (Leaflet + Plotly.js) pro 61 povodí LAPV a klimatické scénáře. Obsahuje mapu OpenStreetMap, čtyři GeoJSON vrstvy, interaktivní výběr lokality a graf s pásy 25.–75. percentilu. Výchozí zapnutou vrstvou je pouze **povodi.geojson**.

## Publikace na GitHub Pages

1. Vytvořte nový **Public** repozitář (například `lapv-geoportal`).
2. Nahrajte do kořene repozitáře **celý obsah této složky** včetně `index.html` a podsložek `assets/` a `data/`. Nepřidávejte nad nimi další vnořenou složku.
3. Otevřete **Settings → Pages → Build and deployment**. Vyberte `Deploy from a branch`, větev `main`, složku `/(root)` a klikněte `Save`.
4. Web bude dostupný na `https://VAS-UCET.github.io/lapv-geoportal/` po dokončení nasazení.

## Lokální testování

Dvojklik na `index.html` obvykle nefunguje, protože prohlížeč z bezpečnostních důvodů blokuje čtení souborů JSON přes `file://`. V terminálu v této složce spusťte `python -m http.server 8000` a otevřete `http://localhost:8000/`.

## Ovládání

- Klikněte na **povodí** nebo lokalitu vyberte v levém panelu. Vybrané povodí se zvýrazní a aktualizuje se graf.
- Přepínejte scénáře `SSP245`, `SSP370`, `SSP585` a horizonty 2050, 2070, 2085 (lze více současně).
- Zvolte proměnnou `P_delta`, `RM_delta`, `T_delta`.
- Zapněte/vypněte průměrnou křivku a průsvitný pás 25.–75. percentilu.
- Ostatní vrstvy (`zatopy`, `MK_plochy`, `MK_body`) jsou při spuštění vypnuté. Lze je nezávisle zapnout.
- Data právě zobrazených kombinací lze vyexportovat pomocí `↓ CSV`, graf jako PNG přes nástrojovou lištu Plotly.
- URL podporuje parametry `?id=59&var=P_delta&sim=SSP245,SSP585&per=2050,2085`.

## Souřadnice a data

Čtyři GeoJSON vrstvy jsou převedené ze S-JTSK / EPSG:5514 do WGS84 / EPSG:4326. Zdrojové soubory v S-JTSK nejsou tímto projektem měněny.

Soubor `data/series.json` obsahuje zkomprimovanou strukturu časových řad z CSV ve formátu `[val_mean,val_25,val_75,val_min,val_max]` pro každý měsíc. Klíč tvoří `ID_Generel|SIM|PER|var`. Výstupní CSV se vytváří z těchto hodnot. Původní soubor CSV je přiložen v `data/` pro kontrolu.

### Externí služby a licence

- Web používá Leaflet a Plotly.js z veřejných CDN a mapové dlaždice OpenStreetMap, a proto k běžnému použití vyžaduje internet.
- Veřejný server `tile.openstreetmap.org` má pravidla používání a negarantuje dostupnost. Při vyšší návštěvnosti nastavte vhodného poskytovatele mapových dlaždic.
- GitHub Pages zveřejňuje celý obsah veřejného repozitáře, včetně GIS geometrie i analytických dat. Před publikací ověřte oprávnění ke zveřejnění.
- Převod geometrie nemění atributy. Dříve zjištěné nevalidní geometrie nebyly automaticky opravovány.
