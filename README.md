# MemePilot

Lokalny skaner nowych tokenów Pump.fun oraz bot do **wirtualnego** paper tradingu. Program nie tworzy prawdziwych portfeli Solana i nie wysyła transakcji on-chain.

## Uruchomienie

1. Włącz Node.js 24 lub nowszy i otwórz terminal w tym folderze.
2. Uruchom `npm start`.
3. Wejdź w przeglądarce na `http://localhost:8787`.
4. Wybierz Konto 1 albo Konto 2. Przy pierwszym wejściu na wolne konto ustaw jego hasło (co najmniej 12 znaków).

Konta działają tylko przez serwer. Nie otwieraj `index.html` jako pliku `file://`.

Konto 1 zachowuje dotychczasowe lokalne portfele paper, salda, historię i ustawienia. Konto 2 rozpoczyna z własnym, pustym portfelem paper i ustawia hasło przy pierwszym wejściu. Każde konto widzi tylko swoje dane. Skaner nowych tokenów jest wspólny.

Po ponownym uruchomieniu serwera konta i dane paper zostają zapisane w `data/`. Boty przywracają zapisany stan — bot działający przed restartem może automatycznie wznowić pracę.

## Panel na GitHub Pages, silnik na komputerze

`npm run build:frontend` przygotowuje publiczny panel w `public-site/`. Na GitHuba wgrywaj wyłącznie zawartość tego folderu. Silnik, konta i klucze pozostają lokalnie. Konfiguracja połączenia i autostartu jest opisana w [DEPLOYMENT.md](DEPLOYMENT.md).

## Dane i bezpieczeństwo

- `data/accounts.json`: konta, skróty haseł i sesje. Haseł nie zapisujemy otwartym tekstem.
- `data/users/`: osobne portfele paper, historia i ustawienia każdego konta.
- `.env`: lokalna konfiguracja połączenia z Solaną. Nie udostępniaj jej publicznie.

Kopię zapasową rób z całego folderu `data/`. Bez niego konta i portfele paper nie przetrwają przeniesienia na inny serwer. Samo skopiowanie kodu strony nie przeniesie danych.

## Hosting bez GitHuba

Projekt pozostaje w tym folderze. Northflank nie przyjmuje samego folderu jako trwałej usługi: potrzebuje kodu z repozytorium Git albo obrazu kontenera z rejestru. Bez GitHuba możliwa jest druga droga, ale wymaga osobnego przygotowania obrazu i trwałego dysku dla `data/`. Nie uruchamiaj tej aplikacji publicznie bez trwałego miejsca na `data/` i bez HTTPS.

Jeśli pierwsze konto będzie tworzone dopiero na publicznym serwerze, ustaw na nim tajną zmienną `MEME_PILOT_SETUP_CODE` i wpisz ten kod podczas pierwszej rejestracji. Lokalnie na `localhost` nie jest potrzebny.

## Testy

`npm test`

