# Tarjouspyyntötutka

Agentti, joka seuraa julkisia hankintailmoituksia (HILMA) ja vastaa suomeksi kysymyksiin kuten

> *"Onko viimeisen puolen vuoden aikana tullut Azure-osaamiseen liittyviä kilpailutuksia, joiden arvo on alle 500 000 €?"*

Vastauksessa on jokaisesta ilmoituksesta otsikko, hankintayksikkö, arvo, määräaika, perustelu ja lähdeviite HILMAan.

## Arkkitehtuuri

```
HILMA AVP API ──ingest.py──► Azure AI Search (hilma-notices)  ◄── search.py ◄── agent.py (gpt-5-mini, tool calling)
 eForms, 12 kk               BM25 fi.microsoft + vektori                          ├ search_notices
 ContractNotices             + semantic ranker                                    ├ get_notice
 CPV 72 / 48 / 794           + suodattimet: arvo, määräaika,                      └ assess_fit (profile.md)
                               julkaisupv, CPV, hankintayksikkö                         │
                                                                         api.py (FastAPI) ◄── frontend (React/TS)
```

| Osa | Tiedosto |
|---|---|
| Nouto, suodatus, upotukset, indeksointi | [backend/hilma/ingest.py](backend/hilma/ingest.py) |
| Indeksin skeema | [backend/hilma/index.py](backend/hilma/index.py) |
| Hybridihaku ja suodattimet | [backend/hilma/search.py](backend/hilma/search.py) |
| Agentti ja kolme työkalua | [backend/hilma/agent.py](backend/hilma/agent.py) |
| Kyvykkyysprofiili | [backend/hilma/profile.md](backend/hilma/profile.md) |
| Evaluointi | [eval/](eval/) |
| Infra | [infra/main.bicep](infra/main.bicep), [.github/workflows/ci.yml](.github/workflows/ci.yml) |

**Data:** HILMAn hakurajapinnasta `POST /avp/eformnotices/docs/search` haettiin 11 666 eForms-muotoista hankintailmoitusta viimeisen 12 kuukauden ajalta. Niistä 1 150 osui ICT- ja konsultointikoodeihin, jolloin CPV-koodit tarkistettiin sekä pääkohteesta että eristä (lots). Hakurajapinta palauttaa jo kuvauksen, erät, arvon, määräajan ja hankintayksikön, joten MVP ei tarvitse erillistä XML-lukurajapintaa.

**CPV-suodatus etuliitteillä:** `cpv_codes`-kenttään tallennetaan täyden koodin lisäksi sen 2-, 3- ja 4-numeroiset etuliitteet. Näin agentti voi rajata esimerkiksi `cpv_codes/any(c: c eq '72')` ilman merkkijonovertailua.

## Käynnistys

```bash
cp .env.example .env         # täytä avaimet
uv sync
cd backend && uv run python -m hilma.index && uv run python -m hilma.ingest
uv run uvicorn hilma.api:app --port 8000
cd ../frontend && npm install && npm run dev   # http://localhost:5173
```

## Evaluointi

### 1. Haun osuvuus: 30 known-item-kysymystä ([eval/retrieval.jsonl](eval/retrieval.jsonl))

Setti koottiin näin: indeksistä poimittiin satunnaisesti 30 ilmoitusta (seed 42). Jokaiseen `gpt-5-mini` kirjoitti kysymyksen, jonka myyjä voisi esittää, mutta **ilman ilmoituksen omia sanamuotoja**: taivutus vaihtuu, yhdyssanat puretaan tai yhdistetään ja tilalle tulee synonyymejä. Esimerkiksi otsikosta *"Työajanseurantajärjestelmän hankinta"* syntyi kysymys *"SaaS-pilvipalvelu työajan kirjausta varten…"*. Mittari kertoo, löytyykö juuri se ilmoitus.

| Hakutapa | R@1 | R@5 | R@10 | MRR@10 |
|---|---|---|---|---|
| BM25 (`fi.microsoft`) | 0.60 | 0.80 | 0.80 | 0.69 |
| Pelkkä vektori (`text-embedding-3-small`) | 0.53–0.57 | 0.77–0.80 | 0.83–0.87 | 0.63–0.66 |
| Hybridi (BM25 + vektori, RRF) | 0.60 | 0.77 | 0.80 | 0.68 |
| **Hybridi + semantic ranker** | **0.70–0.73** | **0.93–0.97** | **0.93–0.97** | **0.81–0.84** |

Luvut ovat kahdesta ajosta. Vektori- ja reranker-tulokset vaihtelevat hieman ajosta toiseen, BM25 ei.

**Havainnot:**
- **Pelkkä vektorihaku häviää BM25:lle.** Suomenkielinen hankintateksti on täynnä yhdyssanoja ja erisnimiä, kuten *Drupal*, *BW4/HANA*, *Gitlab* ja *PostgreSQL*. `text-embedding-3-small` hukkaa ne, mutta `fi.microsoft`-analysaattori perusmuotoistaa ja pilkkoo yhdyssanat, joten tarkat termit osuvat. Tämä on syy siihen, ettei ratkaisu ole pelkkä vektorihaku.
- **Pelkkä hybridi ei parantanut tulosta.** RRF-yhdistäminen tasoitti BM25:n ja vektorin tulokset lähelle BM25:tä. Hyöty syntyi vasta semantic rankerista, joka luki ehdokkaat ja järjesti ne uudelleen. BM25 ja vektori tuottavat yhdessä hyvän ehdokasjoukon, ja reranker valitsee siitä parhaat.
- Hudit ovat enimmäkseen kysymyksiä, joissa ei ole yhtään tarkkaa termiä, esimerkiksi *"kosketusvuorovaikutuksellinen ohjausjärjestelmä"*, kun ilmoitus on englanniksi (*Immersive space control system*).

### 2. Agentin vastausten pohjautuminen lähteisiin ([eval/agent.jsonl](eval/agent.jsonl))

Jokaisessa ajossa tarkistetaan kolme asiaa:
- **Viitteiden aitous:** jokainen vastauksen `[HILMA id]` on olemassa indeksissä, ja sama ajo on hakenut sen työkalulla. Näin agentti ei voi viitata muistinvaraisesti.
- **Odotettu osuma:** tietty ilmoitus löytyy kysymykseen, jonka vastaus tiedetään.
- **Rajausten noudattaminen:** yksikään viitattu ilmoitus, jonka arvo tiedetään, ei ylitä käyttäjän antamaa arvorajaa.

| Mittari | Vain kehote | + kynnysarvo | + rajaukset koodissa |
|---|---|---|---|
| Viitteet olemassa ja haettu työkalulla | 1.00 | 1.00 | 1.00 |
| Odotettu ilmoitus viitattu (Azure-kysymys) | 1.00 | 1.00 | 1.00 |
| **Arvorajaa noudatettu** | – | 0.50 | **1.00** (lisäksi 3/3 toistoa) |

## Mikä ei toiminut ja mitä korjattiin

1. **Vektorihaku palauttaa aina jotain.** Kysymykseen *"kvanttitietokoneiden ohjelmointi alle 5 000 €"* vektorihaku palautti neljä aiheeseen liittymätöntä ilmoitusta, koska k lähintä naapuria löytyy aina. Reranker-pisteiden tarkastelu näytti selvän eron: epärelevanttien osumien paras pistemäärä oli 1.47 ja oikeiden osumien huonoin 2.13. Agentin hakutyökalu pudottaa nyt tulokset, joiden reranker-pisteet jäävät alle 1.8. Evaluoinnin hakuvertailu ajetaan ilman kynnystä, jotta vertailu hakutapojen välillä pysyy reiluna.
2. **Ensimmäinen testi mittasi väärää asiaa.** Oletin, ettei kvanttiaiheisia ilmoituksia ole, ja testasin, että vastauksessa ei ole viitteitä. Toistoissa agentti kuitenkin viittasi aitoon ilmoitukseen *LUMI-IQ Quantum Computing Platform*, jossa ei ole ilmoitettu arvoa. Se ei ole virhe. Varsinainen virhe oli toisaalla: samassa vastauksessa oli tietoturvatestaus, jonka arvo on 800 000 €. Testi mittaa nyt sitä, mikä oikeasti on väärin, eli rikkooko viitattu ilmoitus käyttäjän antamaa rajaa.
3. **Rajaus kehotteessa ei ole takuu.** Kehotteeseen lisätty sääntö "rajaukset ovat ehdottomia" ei auttanut. Kun malli teki uusintahakuja, se jätti `max_value`-arvon pois. Nyt käyttäjän kysymyksestä poimitaan kerran rakenteiset rajat (`max_value`, `min_value`, `published_after`, `deadline_after`), ja koodi lisää ne jokaiseen hakukutsuun mallin antamien arvojen päälle. Tulos nousi 0.50:stä 1.00:aan.
4. **Lähdelista oli liian laaja.** Aluksi käyttöliittymä näytti lähteinä kaikki noin 50 ilmoitusta, jotka agentti oli nähnyt. Nyt `sources` sisältää vain vastauksessa viitatut ilmoitukset, ja `retrieved` pitää kirjaa kaikesta nähdystä groundedness-tarkistusta varten.
5. **Embedding-deployment ei vastannut.** `text-embedding-3-small` GlobalStandard-SKU:lla näkyi tilassa *Succeeded*, mutta palautti swedencentralissa 404 `DeploymentNotFound` vielä 20 minuutin jälkeen. Standard-SKU:ta ei ole tarjolla tällä alueella. DataZoneStandard toimi heti ja pitää käsittelyn EU:ssa, mikä on julkisen sektorin datalle muutenkin oikea valinta.

## Rajoitukset ja jatko

- **Evaluointisetti on LLM:n tuottama.** Se on tarkistettava käsin. Osa kysymyksistä vuotaa tarkkoja yksityiskohtia, kuten päivämääriä ja lukuja, mikä helpottaa hakua. Joukossa on myös kaksi ICT:hen kuulumatonta ilmoitusta (metrojunat, jätehuollon verkkosivut), jotka pääsivät mukaan eriin merkityn CPV 48 -koodin vuoksi.
- **Agentin evaluointi on pieni** (7 kysymystä), ja agentin käytös vaihtelee ajosta toiseen. Luotettava arvio vaatii useita ajoja ja mediaanin.
- **Agentti on toteutettu Chat Completions -rajapinnan tool calling -silmukkana.** Seuraava askel on siirtää samat kolme työkalua Foundry Agent Serviceen. Silloin myös tunnistautuminen vaihtuu API-avaimista Entra ID -tunnistautumiseen (managed identity).
- **Bicep kattaa Searchin ja embedding-deploymentin.** Sovelluksen hostaus (Container Apps ja Static Web Apps) puuttuu vielä.
- **Täysi eForms-XML** (osallistumisehdot, vertailuperusteet) parantaisi `assess_fit`-arviota. Sen lukurajapinnan polkua ei vielä löytynyt.
- **CI** ajaa hakuevaluoinnin oikeaa indeksiä vasten ja kaatuu, jos semantic-haun R@5 laskee alle 0.8. Tämä vaatii GitHub-secretit `FOUNDRY_ENDPOINT`, `FOUNDRY_API_KEY`, `SEARCH_ENDPOINT` ja `SEARCH_API_KEY`.
