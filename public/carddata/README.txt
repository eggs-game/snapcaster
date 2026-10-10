Generated recognition catalog from Scryfall's default_cards bulk snapshot.
Includes eligible paper printings with images and independently imaged back faces.
See manifest.json for exact counts, schemas and upstream snapshot provenance.

The Build card index GitHub Action refreshes this catalog daily or on manual
dispatch. Existing visual hashes are reused; Oracle metadata is refreshed and
new faces are hashed. A failed face download prevents partial publication.
scripts/verify_card_index.py verifies all shard and binary row alignment.
