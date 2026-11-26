# Caccia Offerte

Pagina statica, in italiano, che mostra offerte e possibili errori di prezzo su Amazon.it. Non c'è un server e non serve un build: GitHub Pages pubblica i file così come sono nella root del branch `main`.

Un processo **esterno a questo repository** fa commit e push di `data/offerte.json` su `main` circa ogni 15 minuti. La pagina scarica quel file (con un parametro anti-cache) e si aggiorna da sola ogni 3 minuti.

## Mettere online il sito (GitHub Pages)

1. Apri il repository su GitHub.
2. Vai su **Settings → Pages**.
3. In **Build and deployment** scegli **Deploy from a branch**.
4. Branch: **main**. Cartella: **/ (root)**.
5. Salva.

Dopo circa un minuto GitHub indica l'indirizzo del sito. Per questo repository è in genere:

`https://mattew78.github.io/Offerte-/`

Il file `.nojekyll` dice a Pages di non passare da Jekyll e di servire i file così come sono. `index.html` è la home.

Per vederla in locale non aprire il file con `file://` (il browser blocca il caricamento del JSON). Avvia un server statico nella root del repository:

```bash
python3 -m http.server 8765
```

Poi apri `http://127.0.0.1:8765`.

## Come arrivano i dati

Il job esterno sovrascrive l'intero `data/offerte.json` (non fa append) e lo pusha su `main`. La pagina:

- richiede `data/offerte.json?t=<timestamp>` con `cache: no-store`, così il browser non tiene una copia vecchia;
- riprova ogni 3 minuti mentre la scheda è visibile, e anche quando ci torni se è passato più tempo;
- mostra al massimo **200** offerte, le più recenti secondo `trovata_il`;
- tollera i campi facoltativi assenti e ignora campi extra o righe che non sono oggetti.

Pages può tenere in cache l'HTML per qualche minuto. Il parametro `t` sulla richiesta del JSON evita la cache del browser su quel file.

## Schema di `data/offerte.json`

File UTF-8, JSON valido, senza commenti e senza virgole finali. I prezzi sono numeri in euro (punto decimale JSON, per esempio `29.99`), non stringhe e non valori già formattati. `sconto_percentuale` è un numero da 0 a 100 (`63` significa 63%, non `0.63`).

### Radice

| Campo | Tipo | Obbligatorio | Descrizione |
| --- | --- | --- | --- |
| `aggiornato` | stringa ISO 8601 | sì | Istante in cui il file è stato generato, con fuso (`2026-11-26T18:05:00+01:00` oppure `Z`). In pagina è mostrato nel fuso **Europe/Rome**. |
| `offerte` | array | sì | Elenco delle offerte, meglio se già dalla più recente. Massimo consigliato: 200. |

### Oggetto offerta

| Campo | Tipo | Obbligatorio | Descrizione |
| --- | --- | --- | --- |
| `id` | stringa | sì | Identificativo stabile tra un aggiornamento e l'altro, di solito l'ASIN. Serve a riconoscere un errore di prezzo già visto. |
| `titolo` | stringa | sì | Nome del prodotto. Nell'esempio di schema qui sotto il titolo inizia con `ESEMPIO`, così non si confonde con un'offerta vera. |
| `url` | stringa | sì | Pagina prodotto Amazon.it (`https://www.amazon.it/dp/...`). Accettati solo `http` e `https`. |
| `immagine` | stringa | no | URL assoluto `https` oppure percorso relativo al sito, per esempio `img/esempio-cuffie.svg`. |
| `categoria` | stringa | sì | Uno di questi valori, scritti così: `Elettronica e informatica`, `Casa ed elettrodomestici`, `Videogiochi e console`. Un valore diverso viene comunque mostrato e compare nei filtri. |
| `prezzo` | numero | sì | Prezzo attuale in euro. |
| `prezzo_abituale` | numero | no | Prezzo di riferimento, mostrato barrato. |
| `minimo_storico` | numero | no | Minimo storico in euro, se noto. |
| `sconto_percentuale` | numero | sì | Sconto rispetto al prezzo abituale, in punti percentuali. |
| `tipo` | stringa | sì | `offerta` oppure `errore_prezzo`. Solo `errore_prezzo` riceve il badge rosso «Possibile errore di prezzo». |
| `venditore` | stringa | no | Nome del venditore. |
| `nota` | stringa | no | Testo breve in italiano. |
| `trovata_il` | stringa ISO 8601 | sì | Quando l'offerta è stata trovata. Da questo campo dipendono «12 min fa», l'ordine «Più recenti» e l'evidenza dell'ultima ora. |

L'`id` deve restare lo stesso finché l'offerta è la stessa. Se cambia a ogni giro, la notifica degli errori di prezzo scatterebbe ogni volta.

### Esempio

```json
{
  "aggiornato": "2026-11-26T18:05:00+01:00",
  "offerte": [
    {
      "id": "B0ESEMPIO1",
      "titolo": "ESEMPIO — Console portatile Aurora",
      "url": "https://www.amazon.it/dp/B0ESEMPIO1",
      "immagine": "img/esempio-console.svg",
      "categoria": "Videogiochi e console",
      "prezzo": 19.9,
      "prezzo_abituale": 249,
      "minimo_storico": 189,
      "sconto_percentuale": 92,
      "tipo": "errore_prezzo",
      "venditore": "Amazon",
      "nota": "Voce di esempio: non è un prodotto reale e il prezzo è inventato.",
      "trovata_il": "2026-11-26T17:57:00+01:00"
    },
    {
      "id": "B0ESEMPIO2",
      "titolo": "ESEMPIO — Cuffie wireless silenziose",
      "url": "https://www.amazon.it/dp/B0ESEMPIO2",
      "immagine": "img/esempio-cuffie.svg",
      "categoria": "Elettronica e informatica",
      "prezzo": 29.99,
      "prezzo_abituale": 79.99,
      "sconto_percentuale": 63,
      "tipo": "offerta",
      "venditore": "Negozio Esempio",
      "nota": "Voce di esempio: non è un prodotto reale e il prezzo è inventato.",
      "trovata_il": "2026-11-26T17:53:00+01:00"
    }
  ]
}
```

Il blocco qui sopra è solo la forma del file. `data/offerte.json` nel repository è quello pubblicato dal job: offerte reali, senza il prefisso `ESEMPIO`. I campi facoltativi si possono omettere (nel file reale, per esempio, può mancare `minimo_storico`). Il job sovrascrive il file per intero.

## Interfaccia

- Filtro per categoria, tipo (`offerta` / `errore_prezzo`) e sconto minimo.
- Ordine per più recenti o per sconto più alto.
- Le offerte con `trovata_il` nell'ultima ora (rispetto all'orologio del dispositivo) sono evidenziate. Un orario fino a 15 minuti nel futuro conta ancora come «adesso»: gli orologi del job e del browser non sono sempre allineati.
- **Vedi su Amazon** apre la pagina prodotto in una nuova scheda con `rel="noopener"`.
- Se il file manca o non è JSON, compare un errore con **Riprova**. Se un aggiornamento successivo fallisce, restano in pagina i dati già caricati.
- Se i filtri non trovano nulla, o se `offerte` è vuoto, compare lo stato vuoto.
- Avvisi facoltativi del browser: con il permesso, una notifica quando compare un `errore_prezzo` il cui `id` non era presente alla visita precedente. Gli id già visti stanno in `localStorage` (`caccia-offerte-errori-visti`). Gli avvisi partono mentre la pagina è aperta (al caricamento o a un aggiornamento), non a scheda chiusa.

## File

| File | Ruolo |
| --- | --- |
| `index.html` | Pagina |
| `styles.css` | Tema scuro, prima il telefono |
| `app.js` | Lettura del JSON, filtri, schede |
| `data/offerte.json` | Dati pubblicati dal job |
| `img/` | Illustrazioni usate solo nell'esempio di schema |
| `.nojekyll` | Pubblicazione Pages senza Jekyll |
