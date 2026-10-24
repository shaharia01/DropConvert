DROPCONVERT FOR ANDROID
=======================
Convert, compress, trim, merge and crop photos, videos, audio, PDFs and Word/text
files - on your phone, with no internet needed once it is installed. Nothing is
uploaded anywhere.

You do NOT need Android Studio or any programming tools. GitHub (free) builds the
app for you in the cloud. This takes about 15 minutes, once.

STEP 1 - Make a free GitHub account
  Go to github.com and sign up (skip if you already have one).

STEP 2 - Make a place for the app
  - Click the + at the top right, then "New repository".
  - Name it:  dropconvert
  - Choose "Private".  Click "Create repository".

STEP 3 - Upload these files
  - Unzip this zip on your computer and OPEN the unzipped folder.
  - You should see:  .github  assets  native  www  build-web.js  package.json  and more.
  - On the GitHub page, click the link "uploading an existing file".
  - Press Ctrl+A inside the folder to select everything, then drag it ALL into the
    browser window. (Drag the things INSIDE the folder, not the folder itself.)
  - Wait for the upload bar to finish, then click the green "Commit changes".

STEP 4 - Wait for the build
  - Click the "Actions" tab at the top of the repository.
  - You will see "Build DropConvert APK" running (yellow dot). It takes roughly 8-15
    minutes. A green tick means it worked.

STEP 5 - Get the app onto your phone
  - On your PHONE, open github.com in Chrome and log in. Open your dropconvert repository.
  - On the right side click "Releases", open the newest one, tap  DropConvert.apk
    to download it.
  - Tap the downloaded file. Android will ask to allow installing from this source -
    allow it. If Play Protect warns that the app is unknown, tap "Install anyway"
    (it is your own app, built from the files you uploaded).

USING IT
  - Open DropConvert, tap "Tap to add files", pick what you want.
  - Use the bottom bar: Convert, Compress, Trim, Merge, Crop, Background.
  - Finished files appear under "Results". "Save" puts them in your phone's
    Downloads > DropConvert folder (open the Files app). "Share" sends them to
    any app (WhatsApp, Drive, Gmail...).

GOOD TO KNOW
  - Video and audio are converted by an engine inside the app. It loads the first time
    you use it. Phones are slower than computers - a long video can take several
    minutes. Keep the app open while it works.
  - Very large videos (hundreds of MB) may run out of memory on a phone.
  - Compressing a PDF rebuilds it from page images, so text can no longer be selected.
  - Not included: HEIC photos, PDF to Word, PowerPoint/Excel.
  - To update the app later, upload changed files the same way; a new build starts itself.

IF THE BUILD TURNS RED (a red X in Actions)
  Click the failed run, click the red step, and send me a screenshot of the red
  error lines. I will fix it.
