# Scheda Cantiere

App web per gestire costi e ricavi di ogni cantiere: ore lavorate, km dei mezzi, scontrini di trasferta, materiali (previsti, mancanti, avanzi), SAL e diario con foto.

- **Capisquadra**: dal telefono inseriscono ore della squadra, km, scontrini con foto, materiali e note di diario. Funziona anche **senza campo**: i dati restano sul telefono e partono appena torna la connessione. Non vedono tariffe, costi e margini.
- **Ufficio**: cruscotto di tutti i cantieri, scheda cantiere stampabile in PDF, approvazione degli scontrini sopra il limite, anagrafiche con tariffe storicizzate, utenti, limiti di spesa, esportazione CSV per il commercialista.

I calcoli sono gli stessi del foglio Excel di prova (`Scheda_cantiere_v2.xlsx`); i test automatici verificano che i totali dei cantieri di esempio coincidano.

## Regole di calcolo

| Voce | Calcolo |
|---|---|
| Manodopera | ore × tariffa oraria dell'operaio **in vigore il giorno del lavoro** |
| Trasporti | km × costo al km del mezzo in vigore quel giorno |
| Trasferte | scontrini entro il limite del loro tipo + scontrini approvati |
| Materiali | (q.tà prevista + aggiunta − avanzata) × prezzo unitario |
| Margine | offerta confermata − costo totale |
| Da fatturare | offerta confermata − SAL emessi |

Limiti di spesa iniziali (modificabili in *Limiti spesa*): pranzo e cena 25 €, acquisto cibo 30 €, pernottamento 90 €, altro 0 € (sempre da approvare).

## Provarla sul computer

Serve [Node.js](https://nodejs.org) 22.13 o successivo.

```bash
npm install
DATA_DIR=./data-demo npm run demo     # carica i dati di esempio
DATA_DIR=./data-demo npm start        # apri http://localhost:3000
```

Accessi di prova: `ufficio@demo.it` / `ufficio123` (ufficio), `rossi@demo.it` / `cantiere123` (caposquadra di C001).

## Metterla in uso

1. Pubblica l'app su un servizio che esegue container Docker con un **disco persistente** montato su `/data` (database e foto stanno lì). Va bene un piccolo server in UE: per circa 20 utenti bastano 512 MB di RAM.
2. Serve **HTTPS** (quasi tutti i servizi lo danno già): senza HTTPS il telefono non installa l'app e non la fa funzionare offline.
3. Crea il primo utente dell'ufficio:
   ```bash
   npm run crea-admin -- tua@email.it "Nome Cognome" unapasswordsicura
   ```
   (dentro il container: `docker exec -it <container> node server/crea-admin.js ...`)
4. Dall'ufficio inserisci operai con tariffa, mezzi con costo al km, cantieri con offerta, poi crea i capisquadra in *Utenti* e assegnali ai cantieri dalla scheda di ciascun cantiere.
5. Sul telefono il caposquadra apre l'indirizzo dell'app e sceglie "Aggiungi alla schermata Home".

**Backup**: basta copiare la cartella `/data` (file `scheda-cantiere.sqlite` e cartella `foto`). Conviene un backup automatico giornaliero.

## Struttura

- `server/` – server Node.js (Express) con database SQLite integrato in Node
  - `db.js` schema, `calcoli.js` bilancio, `app.js` API e permessi
- `public/` – app web senza passaggi di compilazione
  - `js/campo.js` schermate del caposquadra, `js/ufficio.js` schermate dell'ufficio, `js/coda.js` funzionamento offline, `sw.js` service worker
- `test/` – test automatici (`npm test`)

## Da fare nelle prossime versioni

- Importazione dei dati dal foglio Excel di prova
- Modifica (oltre che cancellazione) degli inserimenti dal telefono
- Anagrafica clienti separata
