# XDROB Tracker

Appka do monitoringu ferm i wylęgarni, podłączona do bazy Supabase. Ten plik prowadzi Cię krok po kroku od zera do działającej appki na desktopie i telefonie.

## 0. Zainstaluj Node.js (jeśli nie masz)

Wejdź na **nodejs.org**, pobierz wersję **LTS**, zainstaluj jak normalny program (klikaj "Dalej"). To środowisko potrzebne do uruchamiania i budowania appki.

Sprawdź, czy się zainstalowało — otwórz terminal (Windows: wyszukaj "PowerShell" lub "Terminal") i wpisz:

```
node --version
```

Powinno pokazać coś jak `v20.x.x`. Jeśli błąd — zrestartuj komputer i spróbuj ponownie.

## 1. Rozpakuj projekt i zainstaluj zależności

Rozpakuj ten folder gdzieś wygodnie (np. Pulpit), potem w terminalu:

```
cd sciezka/do/xdrob-tracker-app
npm install
```

To pobierze wszystkie potrzebne "klocki" (React, Supabase, itd.) do folderu `node_modules`. Może potrwać minutę.

## 2. Uruchom appkę lokalnie (test)

```
npm run dev
```

Terminal pokaże adres, zwykle `http://localhost:5173`. Otwórz go w przeglądarce — appka powinna działać, poprosić o logowanie.

**Załóż konto** przez appkę (zakładka "Utwórz konto" na ekranie logowania) — użyj swojego prawdziwego e-maila.

> Uwaga: Supabase domyślnie wymaga potwierdzenia e-mail przed pierwszym logowaniem. Jeśli chcesz to wyłączyć na czas testów (żeby nie czekać na maila): w panelu Supabase → **Authentication → Providers → Email** → wyłącz "Confirm email".

## 3. Wgraj historyczne dane z Excela (jednorazowo)

W pliku `.env` dopisz na końcu swój login do appki (ten sam, który właśnie założyłeś):

```
SEED_EMAIL=twoj@email.pl
SEED_PASSWORD=twoje_haslo
```

Potem w terminalu:

```
npm run seed
```

To wgra 8 kurników, ~470 wpisów dziennych, 75 partii wylęgów i pozostałe dane historyczne prosto do bazy. Zajmie chwilę — zobaczysz postęp w terminalu.

**Po zakończeniu usuń te dwie linie z `.env`** (nie musisz ich trzymać w pliku na stałe).

## 4. Zrób się administratorem

Nowe konta domyślnie mają rolę "pracownik". Żeby mieć pełny dostęp:

1. Wejdź w panel Supabase → **Table Editor** → tabela `profiles`
2. Znajdź swój wiersz (po e-mailu)
3. Kliknij w kolumnę `role`, zmień `worker` na `admin`, zapisz

Odśwież appkę — powinieneś zobaczyć wybór "Wersja administratora / Wersja pracownika".

Tak samo zrób dla kont wujków, kiedy je założą.

## 5. Wystaw appkę do internetu (Vercel)

1. Załóż darmowe konto na **github.com**, stwórz nowe puste repozytorium (np. `xdrob-tracker`)
2. W terminalu, w folderze projektu:
   ```
   git init
   git add .
   git commit -m "start"
   git branch -M main
   git remote add origin ADRES_TWOJEGO_REPO_Z_GITHUB
   git push -u origin main
   ```
   (Adres repo znajdziesz na stronie repozytorium, przycisk "Code" → HTTPS)
3. Załóż darmowe konto na **vercel.com**, zaloguj się przez GitHub
4. "Add New Project" → wybierz swoje repozytorium `xdrob-tracker`
5. W ustawieniach projektu, sekcja **Environment Variables**, dodaj dwie zmienne (te same wartości co w `.env`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Kliknij **Deploy**

Po chwili dostaniesz adres typu `xdrob-tracker.vercel.app` — appka jest już publicznie dostępna (tylko dla osób, które znają adres i mają założone konto — dane nie są indeksowane przez Google).

Każda kolejna zmiana w kodzie, którą wypchniesz na GitHub (`git push`), automatycznie się tam zaktualizuje.

## 6. Zainstaluj appkę jak program / appkę mobilną

- **Desktop (Chrome/Edge):** wejdź na adres z Vercela, w pasku adresu pojawi się ikonka instalacji (albo menu → "Zainstaluj XDROB Tracker"). Appka dostanie ikonę na pulpicie i będzie się otwierać w osobnym oknie.
- **Telefon/tablet:** wejdź na adres w przeglądarce, menu → "Dodaj do ekranu głównego".

## Czego jeszcze brakuje / co warto zrobić dalej

- **Analiza AI** — przycisk jest, ale wyłączony. Działała tylko wewnątrz Claude; żeby wróciła tutaj, potrzebny jest mały serwer (np. funkcja na Vercelu) trzymający bezpiecznie klucz API do Anthropic. Osobny krok, mogę pomóc jak dojdziemy do tego etapu.
- **Uprawnienia dopracowane bardziej precyzyjnie** — obecnie każdy zalogowany użytkownik ma dostęp do wszystkich danych (reguły RLS w bazie). Dla małego zespołu rodzinnego to OK, ale docelowo można ograniczyć np. pracownika tylko do jego fermy.
- **Kasowanie jest teraz trwałe** — usunięcie kurnika/fermy kasuje też jego historię wpisów (kaskadowo w bazie). Przy pracy uważaj na przyciski usuwania — mają podwójne potwierdzenie, ale nieodwracalne.
- **Dostawcy zewnętrzni** (`SUPPLIERS` w kodzie) są nadal wpisani na sztywno w appce — jeśli lista dostawców się zmienia, na razie wymaga edycji kodu, nie ma do tego ekranu w interfejsie.
