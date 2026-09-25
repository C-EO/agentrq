# Publishing to the Chrome Web Store

The first version goes up by hand, because the store only issues the
extension's ID once an item exists. After that, pushing a `chrome-v<version>`
tag publishes: `plugin-chrome-release.yml` tests, packages, uploads and submits
the version for review, and attaches the zip to a GitHub release.

## 1. The first submission, by hand

1. Register at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   with the Google account that should own the listing, and pay the one-time
   registration fee (US$5 for years; the page shows the current amount). The
   account's email cannot be changed later. For a company, consider a
   [group publisher](https://developer.chrome.com/docs/webstore/group-publishers)
   so the listing is not one person's.
2. Download the `agentrq-chrome-extension` artifact from the latest **Chrome
   Plugin** run on `main`, or the zip on a `chrome-v*` GitHub release.
3. **New item** → upload that zip **as it is, without unzipping it**:
   `manifest.json` is at its root, which is what the store checks. (Builds
   before PR #689 came as a zip inside a zip; upload the inner one.)
4. Fill in the tabs from [`store/LISTING.md`](store/LISTING.md), then
   **Submit for review**.
5. Note two IDs for step 2:
   - the **item ID**, the 32 letters in the item's dashboard URL
   - the **publisher ID**, under *Publisher* → *Settings*.

## 2. Keyless publishing from CI, once

CI signs in to Google with GitHub's own OIDC token, through Workload Identity
Federation, as a service account the store trusts. There is no key file, OAuth
client or refresh token, so nothing can leak and nothing expires.

In a Google Cloud project (any; a new `agentrq-release` one keeps it tidy):

```sh
PROJECT_ID=agentrq-release
gcloud config set project "$PROJECT_ID"
gcloud services enable chromewebstore.googleapis.com iamcredentials.googleapis.com

# The identity CI will act as. It needs no Cloud roles of its own.
gcloud iam service-accounts create chrome-web-store --display-name="Chrome Web Store publishing"
SA="chrome-web-store@${PROJECT_ID}.iam.gserviceaccount.com"

# A pool that admits only GitHub Actions runs from the agentrq organisation.
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc agentrq \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'agentrq'"

# Only agentrq/agentrq may act as the service account.
POOL=$(gcloud iam workload-identity-pools describe github --location=global --format='value(name)')
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL}/attribute.repository/agentrq/agentrq"

# The value for CWS_WORKLOAD_IDENTITY_PROVIDER below.
gcloud iam workload-identity-pools providers describe agentrq \
  --location=global --workload-identity-pool=github --format='value(name)'
echo "$SA"
```

Then:

1. In the Developer Dashboard → **Account** → **Service account**, add the
   `chrome-web-store@…` address. A publisher can have only one.
2. In GitHub → *Settings* → *Secrets and variables* → *Actions* → **Variables**
   (none of these are secret), add:

   | Variable | Value |
   |---|---|
   | `CWS_WORKLOAD_IDENTITY_PROVIDER` | the `projects/…/providers/agentrq` name printed above |
   | `CWS_SERVICE_ACCOUNT` | `chrome-web-store@agentrq-release.iam.gserviceaccount.com` |
   | `CWS_PUBLISHER_ID` | from step 1 |
   | `CWS_EXTENSION_ID` | from step 1 |

## 3. Every release after that

1. Raise `version` in **both** `manifest.json` and `package.json` (a test
   fails if they differ) and merge it.
2. Tag the merge and push the tag:

   ```sh
   git tag chrome-v1.0.1 && git push origin chrome-v1.0.1
   ```

The job fails, and publishes nothing, if the tag and `manifest.json` disagree,
if the store refuses the package, or if a variable is missing. When it
succeeds the version is **pending review**; the store publishes it once it is
approved, usually within a few days, and emails the publisher either way.

The store refuses a version it already has, so a rejected release goes out
again as the next version, not as the same tag.
