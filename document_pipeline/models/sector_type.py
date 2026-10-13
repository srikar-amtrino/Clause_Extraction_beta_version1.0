from django.db import models


class SectorType(models.Model):
    name = models.CharField(max_length=255, unique=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'sector_types'
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.name
