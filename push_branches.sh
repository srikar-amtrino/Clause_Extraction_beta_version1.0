# Run this entire block in your terminal from the project root
# c:\accorder ai\Clause_Extraction_beta_version1.0

# 1. Push main (will trigger GitHub login popup if not already authenticated)
git push -u origin main

# 2. Create and push develop
git checkout -b develop
git push -u origin develop

# 3. Sprint branches — backend
git checkout -b backend/settings-and-config
git push -u origin backend/settings-and-config
git checkout develop

git checkout -b backend/document-pipeline-models
git push -u origin backend/document-pipeline-models
git checkout develop

git checkout -b backend/core-models
git push -u origin backend/core-models
git checkout develop

# 4. Sprint branch — frontend
git checkout -b frontend/project-setup
git push -u origin frontend/project-setup
git checkout develop

# 5. Confirm everything is pushed
git branch -a
